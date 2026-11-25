import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "./db.ts";
import { parseDetails } from "./lidl/details.ts";
import { translateText, translateTitles, translationEnabled } from "./translate.ts";

const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const DELAY_MS = Number(process.env.CRAWL_DELAY_MS || 400);
const MAX_PDF_MB = Number(process.env.MANUAL_MAX_PDF_MB || 20);
const MAX_PER_PRODUCT = Number(process.env.MANUAL_MAX_PER_PRODUCT || 6);
const MAX_PER_RUN = Number(process.env.MANUAL_FETCH_PER_RUN || 25);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ParsedManual = { url: string; title: string; language: string | null };

// Extract description + specs from an already-fetched product page, translate
// them to English and store them on the product (ParkPrice-style detail block).
export async function describeProduct(erpNumber: string, html: string): Promise<void> {
  const { description, specs } = parseDetails(html);
  if (!description && !specs?.length) return;
  const data: Record<string, unknown> = {};
  if (description) data.description = description;
  if (specs?.length) {
    data.specs = JSON.stringify(specs);
    if (translationEnabled()) {
      const map = await translateTitles(specs.flatMap((s) => [s.k, s.v]));
      const translated = specs.map((s) => ({
        k: map.get(s.k) ?? s.k,
        v: map.get(s.v) ?? s.v,
      }));
      if (translated.length) data.specsEn = JSON.stringify(translated);
    }
  }
  if (description && translationEnabled()) {
    const en = await translateText(description);
    if (en && en !== description) data.descriptionEn = en.slice(0, 1500);
  }
  try {
    await prisma.product.update({ where: { erpNumber }, data });
  } catch {
    // product may have been deleted mid-run — ignore
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

// The "Anleitungen & Downloads" block: one <tr class="downloads__body"> per
// document with a PDF link, a language cell and a file-name cell.
export function parseManuals(html: string): ParsedManual[] {
  const out: ParsedManual[] = [];
  const seen = new Set<string>();
  for (const row of html.match(/<tr class="downloads__body"[\s\S]{0,3000}?<\/tr>/g) ?? []) {
    const href = row.match(/href="([^"]+\.pdf[^"]*)"/)?.[1] ?? null;
    if (!href) continue;
    const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? []).map((c) =>
      c.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    );
    const downloadAttr = row.match(/download="([^"]*)"/)?.[1] ?? "";
    const title = decodeEntities(downloadAttr || cells[cells.length - 1] || "Manual").slice(0, 300);
    const language = cells.length >= 3 ? cells[cells.length - 2] || null : null;
    const url = decodeEntities(href);
    if (!/^https?:\/\//.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title, language });
  }
  if (!out.length) {
    for (const u of [...new Set(html.match(/https?:\/\/manuals\.sit-connect\.com[^"'\s\\]+\.pdf[^"'\s\\]*/g) ?? [])]) {
      const url = decodeEntities(u);
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ url, title: "Manual", language: null });
    }
  }
  return out;
}

function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || "data");
}

async function storeManualPdf(erp: string, url: string): Promise<{ stored: boolean; sha256: string | null; sizeBytes: number | null }> {
  try {
    const r = await fetch(url, { headers: { "user-agent": USER_AGENT } });
    if (!r.ok) return { stored: false, sha256: null, sizeBytes: null };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.subarray(0, 5).toString() !== "%PDF-") return { stored: false, sha256: null, sizeBytes: buf.length };
    if (buf.length > MAX_PDF_MB * 1024 * 1024) return { stored: false, sha256: null, sizeBytes: buf.length };
    const sha = createHash("sha256").update(buf).digest("hex");
    const dupe = await prisma.manual.findFirst({
      where: { erpNumber: erp, sha256: sha },
      select: { id: true },
    });
    const dir = path.join(dataDir(), "manuals", erp.replace(/[^A-Za-z0-9_-]/g, "_"));
    if (!dupe) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${sha}.pdf`), buf);
    }
    return { stored: true, sha256: sha, sizeBytes: buf.length };
  } catch {
    return { stored: false, sha256: null, sizeBytes: null };
  }
}

// Products are checked via one of their listing pages. Manuals are currently
// published mainly on the German (and some other) country sites, so prefer
// those hosts, then fall back to any other listing URL.
function preferredUrls(listings: { url: string | null; countryCode: string }[], tries = 2): string[] {
  const good = listings.filter((l) => l.url).map((l) => ({ url: l.url!, cc: l.countryCode }));
  const ranked = [
    ...good.filter((l) => l.cc === "DE"),
    ...good.filter((l) => ["AT", "NL", "CZ", "SK", "HR", "SI", "IE", "FI", "MT", "LU", "CY"].includes(l.cc)),
    ...good,
  ];
  const urls: string[] = [];
  for (const l of ranked) {
    if (!urls.includes(l.url)) urls.push(l.url);
    if (urls.length >= tries) break;
  }
  return urls;
}

export type ManualSummary = { products: number; manuals: number; stored: number; errors: number };

export async function fetchManuals(
  opts: { countries?: string[]; maxPerRun?: number } = {},
): Promise<ManualSummary> {
  const perRun = Math.max(0, opts.maxPerRun ?? MAX_PER_RUN);
  const wanted = opts.countries?.map((c) => c.toUpperCase());

  const candidates = await prisma.product.findMany({
    where: {
      OR: [{ manualCheckedAt: null }, { description: null }],
      listings: wanted?.length ? { some: { url: { not: null }, countryCode: { in: wanted } } } : { some: { url: { not: null } } },
    },
    orderBy: { firstSeen: "desc" },
    select: {
      erpNumber: true,
      description: true,
      listings: { select: { url: true, countryCode: true } },
      trackings: { select: { id: true } },
    },
    take: 500,
  });
  // tracked products first — their owners most likely want the manual
  candidates.sort((a, b) => Number(b.trackings.length > 0) - Number(a.trackings.length > 0));

  let checked = 0;
  let manuals = 0;
  let stored = 0;
  let errors = 0;

  for (const product of candidates) {
    if (checked >= perRun) break;
    checked++;
    let found: ParsedManual[] = [];
    let pageHtml: string | null = null;
    const urls = preferredUrls(product.listings);
    for (const u of urls) {
      const html = await fetchText(u);
      if (html && !pageHtml) pageHtml = html;
      if (html) found = parseManuals(html);
      await sleep(DELAY_MS);
      if (found.length) break;
    }
    if (pageHtml && !product.description) 
      await describeProduct(product.erpNumber, pageHtml);
    if (!found.length) {
      await prisma.product.update({ where: { erpNumber: product.erpNumber }, data: { manualCheckedAt: new Date() } });
      continue;
    }

    const existing = await prisma.manual.findMany({
      where: { erpNumber: product.erpNumber },
      select: { url: true, sha256: true, stored: true },
    });
    const knownUrls = new Set(existing.map((m) => m.url));
    const knownShas = new Set(existing.filter((m) => m.sha256).map((m) => m.sha256!));

    for (const m of found.slice(0, MAX_PER_PRODUCT)) {
      manuals++;
      if (knownUrls.has(m.url)) continue;
      knownUrls.add(m.url);
      let sha256: string | null = null;
      let sizeBytes: number | null = null;
      let storedPath: string | null = null;
      let isStored = false;
      // same file already archived under this product => link the existing copy
      const existingRow = await prisma.manual.findFirst({ where: { erpNumber: product.erpNumber, url: m.url } });
      if (existingRow?.stored) {
        continue;
      }
      const dl = await storeManualPdf(product.erpNumber, m.url);
      sha256 = dl.sha256;
      sizeBytes = dl.sizeBytes;
      isStored = dl.stored;
      if (isStored && sha256) {
        if (knownShas.has(sha256)) {
          isStored = false;
        } else {
          knownShas.add(sha256);
          storedPath = path.posix.join("manuals", product.erpNumber.replace(/[^A-Za-z0-9_-]/g, "_"), `${sha256}.pdf`);
          stored++;
        }
      }
      await prisma.manual.upsert({
        where: { erpNumber_url: { erpNumber: product.erpNumber, url: m.url } },
        update: { title: m.title, language: m.language, sha256, sizeBytes, stored: isStored, storedPath, fetchedAt: new Date() },
        create: {
          erpNumber: product.erpNumber,
          url: m.url,
          title: m.title,
          language: m.language,
          sha256,
          sizeBytes,
          stored: isStored,
          storedPath,
        },
      });
      await sleep(DELAY_MS);
    }
    await prisma.product.update({ where: { erpNumber: product.erpNumber }, data: { manualCheckedAt: new Date() } });
  }

  return { products: checked, manuals, stored, errors };
}

export async function readManualFile(manualId: number): Promise<{ buf: Buffer; title: string } | null> {
  const m = await prisma.manual.findUnique({ where: { id: manualId } });
  if (!m?.stored || !m.storedPath) return null;
  const file = path.join(dataDir(), m.storedPath);
  try {
    return { buf: fs.readFileSync(file), title: m.title || m.erpNumber };
  } catch {
    return null;
  }
}
