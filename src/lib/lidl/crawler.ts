import { PrismaClient } from "@prisma/client";
import { BRANDS, COUNTRIES, inFamily, slugifyBrand, type CountryConfig } from "./catalog.ts";
import { brandItems, type LidlItem } from "./client.ts";
import { getFxRates, type FxRates } from "../fx.ts";

const prisma = new PrismaClient();

export type CrawlOptions = {
  countries?: string[];
  brands?: string[];
  source?: string;
  maxItemsPerBrand?: number;
};

export type CrawlSummary = {
  runId: number;
  countries: number;
  newItems: number;
  priceChanges: number;
  errors: number;
  items: number;
  truncated?: number;
};

// per-brand/keyword cap; large storefronts (DE/UK) can return >1000 items for
// a single brand keyword, so this must stay comfortably above numFound
const MAX_PER_BRAND = Number(process.env.CRAWL_MAX_PER_BRAND || 3000);

const DELAY_MS = Number(process.env.CRAWL_DELAY_MS || 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let fxCache: FxRates | null = null;
// rate such that local = EUR x fxRate (ECB reference at crawl time; 1 for the euro area)
async function fxRateFor(currency?: string): Promise<number | null> {
  if (!currency) return null;
  if (currency === "EUR") return 1;
  if (!fxCache) fxCache = await getFxRates();
  return fxCache?.rates[currency] ?? null;
}

function promoLabel(item: LidlItem): string | undefined {
  if (item.dealOfDay) return "Deal of the day" + (item.promo ? ` | ${item.promo}` : "");
  if (item.flashSale) return "Flash sale" + (item.promo ? ` | ${item.promo}` : "");
  return item.promo;
}

async function ensureCountries() {
  for (const c of COUNTRIES) {
    await prisma.country.upsert({
      where: { code: c.code },
      update: { host: c.host, locale: c.locale, assortment: c.assortment, currency: c.currency },
      create: { code: c.code, name: c.name, host: c.host, locale: c.locale, assortment: c.assortment, currency: c.currency, enabled: c.enabled },
    });
  }
}

async function upsertItem(item: LidlItem, cc: CountryConfig): Promise<{ isNew: boolean; priceChanged: boolean }> {
  const brandSlug = slugifyBrand(item.brandName);
  const now = new Date();

  const existingProduct = await prisma.product.findUnique({ where: { erpNumber: item.erpNumber }, select: { titleEn: true } });
  const productData = {
    title: item.title,
    brandName: item.brandName,
    brandSlug,
    lastSeen: now,
    removed: false,
    ...(item.images?.length ? { images: JSON.stringify(item.images.slice(0, 4)) } : {}),
  };
  // translation is decoupled from crawling: originals are stored here fast,
  // the title-backfill pass translates them in its own scheduled pass
  const titleEn = existingProduct?.titleEn ?? null;

  await prisma.product.upsert({
    where: { erpNumber: item.erpNumber },
    update: { ...productData, ...(titleEn ? { titleEn } : {}), ...(item.ians?.length ? { ians: JSON.stringify(item.ians) } : {}) },
    create: {
      erpNumber: item.erpNumber,
      ...productData,
      ...(item.ians?.length ? { ians: JSON.stringify(item.ians) } : {}),
      category: item.category,
      imageUrl: item.imageUrl,
      images: item.images?.length ? JSON.stringify(item.images.slice(0, 4)) : undefined,
      ...(titleEn ? { titleEn } : {}),
    },
  });

  const price = item.price ?? null;
  const existing = await prisma.listing.findUnique({
    where: { erpNumber_countryCode: { erpNumber: item.erpNumber, countryCode: cc.code } },
  });

  const data = {
    url: item.url ? `https://${cc.host}${item.url}` : item.url ?? null,
    currentPrice: price,
    oldPrice: item.oldPrice,
    currency: item.currency ?? cc.currency,
    online: item.online,
    stockText: item.stockText,
    stockOk: item.stockOk,
    promo: promoLabel(item),
    priceUpdatedAt: now,
  };

  const listing = await prisma.listing.upsert({
    where: { erpNumber_countryCode: { erpNumber: item.erpNumber, countryCode: cc.code } },
    update: data,
    create: { erpNumber: item.erpNumber, countryCode: cc.code, ...data },
  });

  await prisma.snapshot.create({
    data: {
      listingId: listing.id,
      erpNumber: item.erpNumber,
      countryCode: cc.code,
      price,
      oldPrice: item.oldPrice,
      available: item.stockOk,
      promo: promoLabel(item),
      fxRate: await fxRateFor(item.currency ?? cc.currency),
    },
  });

  return {
    isNew: !existing,
    priceChanged: !!existing && existing.currentPrice !== null && price !== null && existing.currentPrice !== price,
  };
}

export type TrackSignal = {
  erpNumber: string;
  title: string;
  kind: "price_drop" | "restock" | "on_sale" | "target";
  message: string;
};

const MAX_NOTIFS_PER_RUN = 200;

// ParkPrice-style evaluation: for every tracked product, compare the two
// newest snapshots of each country listing and emit signals on
// price drops, restocks and new promo ribbons, applying the per-track
// filters set in the tracking popup (country / price ≤ / offer / online).
export async function evaluateTrackings(): Promise<number> {
  const trackings = await prisma.tracking.findMany({ include: { product: { include: { listings: true } } } });
  if (!trackings.length) return 0;

  let created = 0;
  const seenSignals = new Set<string>();

  for (const t of trackings) {
    const p = t.product;
    for (const listing of p.listings) {
      if (t.countryCode && listing.countryCode !== t.countryCode) continue;
      if (t.onlineOnly != null && (listing.online ?? false) !== t.onlineOnly) continue;
      const snaps = await prisma.snapshot.findMany({
        where: { listingId: listing.id },
        orderBy: { takenAt: "desc" },
        take: 2,
      });
      if (snaps.length < 2) continue;
      const [nowSn, beforeSn] = snaps;

      const target = t.maxPrice;

      let signal: TrackSignal | null = null;
      if (
        target != null &&
        nowSn.price != null &&
        nowSn.price <= target &&
        (beforeSn.price == null || beforeSn.price > target)
      ) {
        signal = {
          erpNumber: p.erpNumber,
          title: p.titleEn || p.title,
          kind: "target",
          message: `Target price reached in ${listing.countryCode}: now ${nowSn.price.toFixed(2)} ${listing.currency ?? ""} (your target ≤ ${target})`,
        };
      } else if (target != null && nowSn.price != null && nowSn.price > target) {
        signal = null;
      } else if (nowSn.price != null && beforeSn.price != null && nowSn.price < beforeSn.price) {
        signal = {
          erpNumber: p.erpNumber,
          title: p.titleEn || p.title,
          kind: "price_drop",
          message: `Price drop in ${listing.countryCode}: ${beforeSn.price.toFixed(2)} → ${nowSn.price.toFixed(2)} ${listing.currency ?? ""}`,
        };
      } else if (beforeSn.available === false && nowSn.available === true) {
        signal = {
          erpNumber: p.erpNumber,
          title: p.titleEn || p.title,
          kind: "restock",
          message: `Back in stock in ${listing.countryCode}${nowSn.price != null ? ` at ${nowSn.price.toFixed(2)} ${listing.currency ?? ""}` : ""}`,
        };
      } else if (nowSn.promo && nowSn.promo !== beforeSn.promo) {
        signal = {
          erpNumber: p.erpNumber,
          title: p.titleEn || p.title,
          kind: "on_sale",
          message: `New promo in ${listing.countryCode}: ${nowSn.promo}`,
        };
      }
      if (!signal) continue;
      if (t.offerOnly === true && !nowSn.promo) continue;
      if (t.offerOnly === false && nowSn.promo) continue;

      const dupe = await prisma.notification.findFirst({
        where: {
          userId: t.userId,
          erpNumber: signal.erpNumber,
          message: signal.message,
          createdAt: { gt: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
        },
      });
      if (dupe) continue;
      const sigKey = `${t.userId}:${signal.erpNumber}:${signal.kind}`;
      if (seenSignals.has(sigKey)) continue;

      await prisma.notification.create({
        data: {
          userId: t.userId,
          erpNumber: t.erpNumber,
          title: signal.title,
          message: signal.message,
          viaEmail: t.notifyEmail,
          viaWhatsapp: t.notifyWhatsapp,
        },
      });
      seenSignals.add(sigKey);
      created++;
      if (created >= MAX_NOTIFS_PER_RUN) return created;
    }
  }
  return created;
}

export async function runCrawl(opts: CrawlOptions = {}): Promise<CrawlSummary> {
  await ensureCountries();
  const run = await prisma.crawlRun.create({
    data: { source: opts.source ?? "manual", countries: 0 },
  });

  let countries = 0;
  let newItems = 0;
  let priceChanges = 0;
  let errors = 0;
  let items = 0;
  let truncated = 0;

  const countriesToCrawl = COUNTRIES.filter((c) => c.enabled && (!opts.countries || opts.countries.map((x) => x.toUpperCase()).includes(c.code)));
  const brandsToCrawl = BRANDS.filter((b) => !opts.brands || opts.brands.includes(b.slug));
  const seen = new Set<string>();

  for (const cc of countriesToCrawl) {
    countries++;
    const countryItems: LidlItem[] = [];
    for (const brand of brandsToCrawl) {
      try {
        const maxItems = opts.maxItemsPerBrand ?? MAX_PER_BRAND;
        const lists = await Promise.all(brand.queries.map((q) => brandItems(cc, q, maxItems)));
        // surface any query that hit the cap — the storefront had more items
        // than we collected, i.e. the crawl was truncated
        for (const list of lists) {
          if (list.numFound > list.items.length) truncated++;
        }
        for (const list of lists) {
          for (const item of list.items) {
            if (!inFamily(brand.family, item.brandName, item.title)) continue;
            const key = `${cc.code}:${item.erpNumber}`;
            if (seen.has(key)) continue;
            seen.add(key);
            items++;
            countryItems.push(item);
          }
        }
      } catch {
        errors++;
      }
    }

    if (countryItems.length) {
      for (const item of countryItems) {
        const r = await upsertItem(item, cc);
        if (r.isNew) newItems++;
        if (r.priceChanged) priceChanges++;
      }
    }

    await sleep(DELAY_MS);
  }

  await prisma.crawlRun.update({
    where: { id: run.id },
    data: {
      finishedAt: new Date(),
      countries,
      newItems,
      priceChanges,
      errors,
      notes: `${items} listings scraped${truncated ? ` · ${truncated} queries truncated (raise CRAWL_MAX_PER_BRAND)` : ""}`,
    },
  });

  return truncated ? { runId: run.id, countries, newItems, priceChanges, errors, items, truncated } : { runId: run.id, countries, newItems, priceChanges, errors, items };
}
