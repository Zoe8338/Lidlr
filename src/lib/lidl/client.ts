import { COUNTRIES, type CountryConfig } from "./catalog.ts";

const DELAY_MS = Number(process.env.CRAWL_DELAY_MS || 400);
const FETCHSIZE = Math.min(Number(process.env.CRAWL_FETCHSIZE || 200), 1000);
const RETRIES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function headers(cc: CountryConfig) {
  return {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 Chrome/124",
    accept: "application/json, text/plain, */*",
    "accept-language": cc.locale.split("_")[0],
    referer: `https://${cc.host}/`,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "x-requested-with": "XMLHttpRequest",
  };
}

export type LidlItem = {
  erpNumber: string;
  ians?: string[];
  title: string;
  brandName?: string;
  brandSlug?: string;
  category?: string;
  imageUrl?: string;
  images?: string[];
  url?: string;
  currency?: string;
  price?: number;
  oldPrice?: number;
  online?: boolean;
  stockText?: string;
  stockOk: boolean;
  promo?: string;
  dealOfDay?: boolean;
  flashSale?: boolean;
};

type GridData = {
  erpNumber?: string;
  productId?: string;
  fullTitle?: string;
  title?: string;
  brand?: { name?: string };
  category?: string;
  ians?: string[];
  canonicalUrl?: string;
  image?: string;
  imageList?: string[];
  online?: boolean;
  price?: { price?: number; oldPrice?: number; currencyCode?: string };
  stockAvailability?: { badgeInfo?: { badges?: { text?: string; type?: string }[] } };
  ribbons?: { type?: string; text?: string }[];
  dealOfDay?: { active?: boolean };
  flashSales?: boolean;
};

type RawItem = { code?: string; gridbox?: { data?: GridData } };

function parseItem(it: RawItem): LidlItem | null {
  const c = it.gridbox?.data;
  if (!c) return null;
  const erp = c.erpNumber || c.productId || it.code;
  if (!erp) return null;
  const badge = c.stockAvailability?.badgeInfo?.badges?.[0];
  const stockOk = badge ? /AVAILABLE/i.test(badge.type || "") : !!c.online;
  const promo = c.ribbons?.map((r) => r.text || r.type).filter(Boolean).join(" | ") || undefined;
  const old = c.price?.oldPrice;
  return {
    erpNumber: String(erp),
    ians: Array.isArray(c.ians) ? c.ians.map(String) : undefined,
    title: c.fullTitle || c.title || erp,
    brandName: c.brand?.name,
    category: c.category,
    imageUrl: c.image,
    images: imageList(c),
    url: c.canonicalUrl || undefined,
    currency: c.price?.currencyCode,
    price: c.price?.price,
    oldPrice: old && old > (c.price?.price ?? 0) ? old : undefined,
    online: c.online,
    stockText: badge?.text,
    stockOk,
    promo,
    dealOfDay: !!c.dealOfDay?.active,
    flashSale: !!c.flashSales,
  };
}

function imageList(c: GridData): string[] | undefined {
  const urls = [...new Set([c.image, ...(c.imageList ?? [])].filter((x): x is string => !!x))];
  return urls.length ? urls.slice(0, 4) : undefined;
}

export function countryByCode(code: string): CountryConfig {
  const c = COUNTRIES.find((c) => c.code === code.toUpperCase());
  if (!c) throw new Error(`Unknown country ${code}`);
  return c;
}

export async function searchPage(opts: {
  country: CountryConfig;
  query?: string;
  brand?: string;
  offset?: number;
  fetchsize?: number;
  signal?: AbortSignal;
}): Promise<{ numFound: number; items: LidlItem[] }> {
  const cc = opts.country;
  const p = new URLSearchParams({
    assortment: cc.assortment,
    locale: cc.locale,
    version: "v2.0.0",
    offset: String(opts.offset ?? 0),
    fetchsize: String(opts.fetchsize ?? FETCHSIZE),
  });
  if (opts.query) p.set("q", opts.query);
  if (opts.brand) p.set("brand", opts.brand);
  const url = `https://${cc.host}/q/api/search?${p.toString()}`;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const r = await fetch(url, { headers: headers(cc), signal: opts.signal });
      if (r.status === 429 || r.status === 401) {
        await sleep(1500 * attempt);
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      const j = (await r.json()) as { numFound?: number; items?: (RawItem | null)[] };
      const items = (j.items ?? [])
        .map((x) => parseItem(x ?? {}))
        .filter((x): x is LidlItem => !!x);
      return { numFound: j.numFound ?? items.length, items };
    } catch (e) {
      lastErr = e;
      await sleep(800 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function brandItems(cc: CountryConfig, brandQuery: string, maxItems = 1000, signal?: AbortSignal) {
  const out: LidlItem[] = [];
  let offset = 0;
  let numFound = Infinity;
  while (offset < Math.min(numFound, maxItems)) {
    // use the keyword query, not the brand filter: several storefronts (PT etc.)
    // ignore the brand= parameter entirely
    const { numFound: found, items } = await searchPage({ country: cc, query: brandQuery, offset, signal });
    numFound = found;
    out.push(...items);
    offset += items.length || FETCHSIZE;
    if (!items.length) break;
    await sleep(DELAY_MS);
  }
  return out;
}
