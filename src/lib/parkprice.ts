// Import ParkPrice (park-price.com) product data into Lidlr: English titles,
// IAN numbers, images and manual links. Gently: single-threaded, seconds
// between requests, robots-compliant (only sitemaps + public product pages;
// /api/ and /forms/ are never touched). Progress is cached in
// data/parkprice-progress.json so re-runs never re-download pages.
//
// IAN numbers come from Lidlr's own crawler (gridbox.data.ians): run a crawl
// first so products carry IANs, then this import can match ParkPrice's pages.
// The CLI wrapper is scripts/parkprice.mjs; the admin dashboard's
// "Import from ParkPrice" job calls importParkPrice() directly.
import fs from "node:fs";
import path from "node:path";
import { prisma } from "./db.ts";
import { BRANDS } from "./lidl/catalog.ts";

export type ParkPriceSummary = {
  urls: number;
  fetched: number;
  cached: number;
  matched: number;
  updated: number;
  created: number;
  notInCatalog: number;
  notFound: number;
  failed: number;
  manualsAdded: number;
  dryRun: boolean;
};

const DEFAULT_DELAY = 3000;
const UA = "Lidlr-product-import/1.0 (single-threaded, seconds between requests)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || "data");
}

function statePath(): string {
  return path.join(dataDir(), "parkprice-progress.json");
}

function loadState(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return {};
  }
}

function saveState(state: Record<string, unknown>) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(state));
  } catch {
    // progress cache is best-effort
  }
}

async function fetchText(url: string, log?: (s: string) => void): Promise<string | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: {
          "user-agent": UA,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;0.8",
        },
      });
      if (r.status === 200) return await r.text();
      if (r.status === 429 || r.status >= 500) {
        log?.(`HTTP ${r.status} — backing off 60 s`);
        await sleep(60000);
        continue;
      }
      log?.(`HTTP ${r.status} for ${url}`);
      return null;
    } catch (e) {
      log?.(`fetch error (${attempt}/3): ${e instanceof Error ? e.message : String(e)}`);
      await sleep(15000);
    }
  }
  return null;
}

async function productUrls(delay: number, log?: (s: string) => void): Promise<string[]> {
  const all: string[] = [];
  for (let p = 1; p <= 32; p++) {
    const xml = await fetchText(`https://www.park-price.com/sitemap-products.xml${p === 1 ? "" : `?p=${p}`}`, log);
    if (!xml) break;
    const locs = [...xml.matchAll(/<loc>(https:\/\/www\.park-price\.com\/en\/product\/[^<]+)<\/loc>/g)].map((m) =>
      m[1].replace(/ /g, "%20"),
    );
    if (!locs.length) break;
    all.push(...locs);
    log?.(`sitemap chunk ${p}: ${locs.length} products`);
    await sleep(delay);
  }
  return all;
}

function parseProduct(html: string): { ian: string | null; title: string | null; img: string | null; manuals: string[] } {
  const ian = html.match(/\(IAN ([0-9a-zA-Z]+)\)/)?.[1] ?? null;
  const title =
    html.match(/<h1>([^<]+)<\/h1>/)?.[1]
      ?.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&lt;/g, "<") ?? null;
  const img = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? null;
  // ParkPrice product pages link manuals two ways: a single "btnOpenPDF"
  // button and/or a "Download the file" table of <a class="downloads-link">,
  // sometimes several per language; both lead to Lidl's media.sit-connect.com
  // PDFs. Accept every .pdf anchor on the page.
  const manuals = [...new Set(
    [...html.matchAll(/<a\b[^>]*href=["']([^"']+\.pdf[^"']*)["'][^>]*>/gi)]
      .map((m) => m[1])
      .filter(Boolean),
  )];
  return { ian, title, img, manuals };
}

// Best-effort brand inference from a ParkPrice English title.
function inferBrand(title: string | null): { brandName: string; brandSlug: string } | null {
  if (!title) return null;
  const up = ` ${title.toUpperCase()} `;
  for (const b of BRANDS) {
    const hit = b.queries.find((q) => up.includes(` ${q.toUpperCase()} `) || up.includes(` ${q.toUpperCase()}`));
    if (hit) return { brandName: hit, brandSlug: b.slug };
  }
  return null;
}

export async function importParkPrice(
  opts: {
    max?: number;
    offset?: number;
    delay?: number;
    refetch?: boolean;
    dryRun?: boolean;
    /** park-price product URLs, URL slugs, or IAN numbers — import only these */
    targets?: string[];
    /** create shell products (erpNumber "IAN-<ian>") for pages with no catalog match */
    createMissing?: boolean;
    log?: (s: string) => void;
  } = {},
): Promise<ParkPriceSummary> {
  const max = opts.max ?? 1e9;
  const offset = opts.offset ?? 0;
  const delay = opts.delay ?? DEFAULT_DELAY;
  const dryRun = !!opts.dryRun;
  const createMissing = !!opts.createMissing;
  const targets = (opts.targets ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 50);
  const log = opts.log ?? ((s: string) => console.log(s));
  const state = loadState();
  const persist = () => saveState(state);

  const products = await prisma.product.findMany({ where: { ians: { not: null } }, select: { erpNumber: true, ians: true } });
  const byIan = new Map<string, string>();
  for (const p of products) {
    try {
      for (const i of JSON.parse(p.ians || "[]") as string[]) if (!byIan.has(i)) byIan.set(i, p.erpNumber);
    } catch {}
  }
  log(`Lidlr catalog: ${byIan.size} unique IANs across ${products.length} products`);

  let urls = await productUrls(delay, log);
  log(`park-price sitemap: ${urls.length} product pages`);

  if (targets.length) {
    // targeted mode: pick just the requested pages. Targets may be full URLs,
    // URL slugs, or IAN numbers (ParkPrice slugs end in "-<IAN>/<internal-id>").
    const norm = (u: string) => u.replace(/\/$/, "").toLowerCase();
    const matchedUrls = new Set<string>();
    for (const t of targets) {
      const isUrl = /^https?:\/\//i.test(t);
      const needle = t.toLowerCase().replace(/\/$/, "");
      // boundary-guarded so IAN 521608 cannot match slug ...-1521608-...
      const re = new RegExp(`(^|[^0-9a-z])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^0-9a-z])`);
      const hit = urls.find((u) => {
        const nu = norm(u);
        return isUrl ? nu === needle || nu.includes(needle) : re.test(nu);
      });
      if (hit) matchedUrls.add(hit);
      else log(`target not found in sitemap: ${t}`);
    }
    urls = [...matchedUrls];
  }
  urls = urls.slice(offset).slice(0, Number.isFinite(max) ? max : undefined);
  log(
    `processing ${urls.length} pages (${targets.length ? "targeted" : `offset ${offset}`}, delay ${delay} ms, ${
      dryRun ? "DRY RUN" : "writing"
    }${createMissing ? ", create-missing ON" : ""})`,
  );

  const summary: ParkPriceSummary = {
    urls: urls.length,
    fetched: 0,
    cached: 0,
    matched: 0,
    updated: 0,
    created: 0,
    notInCatalog: 0,
    notFound: targets.length - urls.length,
    failed: 0,
    manualsAdded: 0,
    dryRun,
  };

  for (const url of urls) {
    const key = url.replace(/^https?:\/\/www\.park-price\.com\/en\/product\//, "").split("/")[0];
    // targeted imports always re-fetch (the admin explicitly asked for these pages)
    if (state[key] && !opts.refetch && !targets.length) {
      summary.cached++;
      continue;
    }

    await sleep(delay);
    const html = await fetchText(url, log);
    if (!html) {
      summary.failed++;
      continue;
    }
    summary.fetched++;
    const { ian, title, img, manuals } = parseProduct(html);

    const matchedErp = ian ? byIan.get(ian) ?? null : null;
    let targetErp: string | null = matchedErp;
    if (!matchedErp && createMissing && ian && !dryRun) {
      // No catalog match: create a shell product keyed by the IAN ("IAN-<ian>").
      // It carries the English title/image/manuals now; if a later crawl finds
      // the real ERP product, both carry the same IAN and surface as a merge
      // suggestion in the admin Products tab.
      const shellErp = `IAN-${ian}`;
      const englishTitle = (title || "").trim();
      const existing = await prisma.product.findUnique({ where: { erpNumber: shellErp }, select: { erpNumber: true } });
      if (!existing) {
        const brand = inferBrand(englishTitle);
        await prisma.product.create({
          data: {
            erpNumber: shellErp,
            title: englishTitle || shellErp,
            titleEn: englishTitle ? englishTitle : null,
            imageUrl: img,
            ians: JSON.stringify([ian]),
            brandName: brand?.brandName ?? null,
            brandSlug: brand?.brandSlug ?? null,
          },
        });
        summary.created++;
        log(`created shell product ${shellErp} (${englishTitle || "no title"})`);
      }
      targetErp = shellErp;
    }
    if (!targetErp) {
      summary.notInCatalog++;
      // never cache pages during a probe/dry-run, so a later real run retries them
      if (!dryRun) {
        state[key] = { ian, title, updated: 0, at: new Date().toISOString() };
        if (summary.fetched % 10 === 0) persist();
      }
      continue;
    }

    const changes: Record<string, string> = {};
    const p = await prisma.product.findUnique({ where: { erpNumber: targetErp }, select: { title: true, titleEn: true, imageUrl: true } });
    const englishTitle = (title || "").trim();
    if (englishTitle && !p?.titleEn) changes.titleEn = englishTitle;
    if (englishTitle && !p?.title) changes.title = englishTitle;
    if (img && !p?.imageUrl) changes.imageUrl = img;
    if (Object.keys(changes).length && !dryRun) {
      await prisma.product.update({ where: { erpNumber: targetErp }, data: changes });
      summary.updated++;
    }
    for (const mUrl of manuals) {
      if (dryRun) continue;
      await prisma.manual.upsert({
        where: { erpNumber_url: { erpNumber: targetErp, url: mUrl } },
        update: {},
        create: { erpNumber: targetErp, url: mUrl, title: "Instruction manual", language: null },
      });
      summary.manualsAdded++;
    }
    summary.matched++;
    if (!dryRun) {
      state[key] = { ian, title, erp: targetErp, manuals, updated: Object.keys(changes).length, at: new Date().toISOString() };
      if (summary.fetched % 10 === 0) persist();
    }
  }
  persist();

  log(
    `Done. fetched=${summary.fetched} cached=${summary.cached} matched=${summary.matched} created=${summary.created} notInCatalog=${summary.notInCatalog} httpFailed=${summary.failed}` +
      ` | products updated: ${dryRun ? "(dry-run — nothing written)" : summary.updated} | manuals added: ${dryRun ? "(dry-run)" : summary.manualsAdded}`,
  );
  return summary;
}
