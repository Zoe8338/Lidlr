import { PrismaClient } from "@prisma/client";
import { BRANDS, COUNTRIES, slugifyBrand, type CountryConfig } from "./catalog.ts";
import { brandItems, type LidlItem } from "./client.ts";

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
};

const DELAY_MS = Number(process.env.CRAWL_DELAY_MS || 400);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  await prisma.product.upsert({
    where: { erpNumber: item.erpNumber },
    update: { title: item.title, brandName: item.brandName, brandSlug, lastSeen: now, removed: false },
    create: {
      erpNumber: item.erpNumber,
      title: item.title,
      brandName: item.brandName,
      brandSlug,
      category: item.category,
      imageUrl: item.imageUrl,
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
    },
  });

  return {
    isNew: !existing,
    priceChanged: !!existing && existing.currentPrice !== null && price !== null && existing.currentPrice !== price,
  };
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

  const countriesToCrawl = COUNTRIES.filter((c) => c.enabled && (!opts.countries || opts.countries.map((x) => x.toUpperCase()).includes(c.code)));
  const brandsToCrawl = BRANDS.filter((b) => !opts.brands || opts.brands.includes(b.slug));
  const seen = new Set<string>();

  for (const cc of countriesToCrawl) {
    countries++;
    for (const brand of brandsToCrawl) {
      try {
        const maxItems = opts.maxItemsPerBrand ?? 1000;
        const lists = await Promise.all(brand.queries.map((q) => brandItems(cc, q, maxItems)));
        for (const list of lists) {
          for (const item of list) {
            const key = `${cc.code}:${item.erpNumber}`;
            if (seen.has(key)) continue;
            seen.add(key);
            items++;
            const r = await upsertItem(item, cc);
            if (r.isNew) newItems++;
            if (r.priceChanged) priceChanges++;
          }
        }
      } catch {
        errors++;
      }
    }
    await sleep(DELAY_MS);
  }

  await prisma.crawlRun.update({
    where: { id: run.id },
    data: { finishedAt: new Date(), countries, newItems, priceChanges, errors, notes: `${items} listings scraped` },
  });

  return { runId: run.id, countries, newItems, priceChanges, errors, items };
}

export async function checkAlerts(): Promise<number> {
  const alerts = await prisma.alert.findMany({ where: { active: true } });
  let fired = 0;
  for (const alert of alerts) {
    const where: { countryCode?: string; currentPrice?: { not?: null; lte?: number } } = {};
    if (alert.countryCode) where.countryCode = alert.countryCode;
    if (alert.maxPrice) where.currentPrice = { not: null, lte: alert.maxPrice };

    const products = await prisma.product.findMany({
      where: {
        removed: false,
        ...(alert.brandSlug ? { brandSlug: alert.brandSlug } : {}),
        ...(alert.query ? { title: { contains: alert.query } } : {}),
      },
      include: { listings: { where } },
      take: 50,
    });

    const matches = products
      .map((p) => ({ p, l: p.listings.find((x) => !alert.countryCode || x.countryCode === alert.countryCode) }))
      .filter((m) => m.l);

    for (const m of matches) {
      const l = m!.l!;
      let message: string;
      if (alert.kind === "in_stock") {
        if (!l.stockOk) continue;
        message = `Back in stock in ${l.countryCode} at ${(l.currentPrice ?? 0).toFixed(2)} ${l.currency}`;
      } else if (alert.kind === "price_below") {
        if (l.currentPrice == null || l.currentPrice > (alert.maxPrice ?? Infinity)) continue;
        message = `Now ${l.currentPrice.toFixed(2)} ${l.currency} in ${l.countryCode} (≤ ${alert.maxPrice})`;
      } else {
        message = `Matched in ${l.countryCode}: ${m.p.title}`;
      }
      const already = await prisma.alertEvent.findFirst({
        where: { alertId: alert.id, erpNumber: m.p.erpNumber, title: message },
      });
      if (already) continue;
      await prisma.alertEvent.create({
        data: { alertId: alert.id, erpNumber: m.p.erpNumber, title: m.p.title, message },
      });
      fired++;
    }
    if (fired > 0) {
      await prisma.alert.update({ where: { id: alert.id }, data: { lastFiredAt: new Date() } });
    }
  }
  return fired;
}
