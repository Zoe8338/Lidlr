import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "./db.ts";
import { COUNTRIES, type CountryConfig } from "./lidl/catalog.ts";

const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const ESI_OVERVIEW = "https://esi.leaflets.schwarz/overview";
const FLYER_API = "https://endpoints.leaflets.schwarz/v4/flyer";
const DELAY_MS = Number(process.env.CRAWL_DELAY_MS || 400);
const MAX_PER_COUNTRY = Number(process.env.LEAFLET_MAX_PER_COUNTRY || 6);
// Evergreen "leaflets" (Lidl Plus perks, seasonal toy catalogues valid for months) are
// skipped: anything valid longer than this is not a weekly flyer.
const MAX_VALIDITY_DAYS = Number(process.env.LEAFLET_MAX_VALIDITY_DAYS || 45);
const MAX_PDF_MB = Number(process.env.LEAFLET_MAX_PDF_MB || 60);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Some countries serve the leaflet widget under more than one locale; try them in order.
const LOCALE_FALLBACKS: Record<string, string[]> = {
  LU: ["de-LU", "fr-LU", "lb-LU"],
  BE: ["fr-BE", "nl-BE"],
};

const cardRe = /<a\s[^>]*class="flyer"[\s\S]*?<\/a>/g;

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

function attr(card: string, name: string): string | null {
  const m = card.match(new RegExp(`${name}="([^"]*)"`));
  return m ? decodeEntities(m[1]) : null;
}

function clientLocales(cc: CountryConfig): string[] {
  const dash = cc.locale.replace("_", "-");
  const alternates = LOCALE_FALLBACKS[cc.code] ?? [];
  return [dash, ...alternates.filter((a) => a !== dash)];
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { "user-agent": USER_AGENT, "x-requested-with": "XMLHttpRequest" } });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

async function discoverCountry(cc: CountryConfig): Promise<
  { flyerId: string; name: string; coverUrl: string | null }[]
> {
  for (const locale of clientLocales(cc)) {
    const html = await fetchText(`${ESI_OVERVIEW}?client_locale=${encodeURIComponent(`lidl/${locale}`)}`);
    if (!html) continue;
    const seen = new Set<string>();
    const cards: { flyerId: string; name: string; coverUrl: string | null }[] = [];
    for (const card of html.match(cardRe) ?? []) {
      const flyerId = attr(card, "data-track-id");
      if (!flyerId || !/^[0-9a-f-]{36}$/i.test(flyerId) || seen.has(flyerId)) continue;
      seen.add(flyerId);
      const name = attr(card, "data-track-name") ?? "";
      const img = card.match(/<img[^>]*class="flyer__image"[^>]*src="([^"]+)"/);
      const coverUrl = img ? img[1] : null;
      // Regional duplicates share the same name; keep only the first occurrence.
      if (cards.some((c) => c.name === name)) continue;
      cards.push({ flyerId, name, coverUrl });
    }
    if (cards.length) return cards;
  }
  return [];
}

function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || "data");
}

async function storePdf(
  flyerId: string,
  cc: CountryConfig,
  pdfUrl: string,
): Promise<{ stored: boolean; sizeBytes: number | null; sha256: string | null }> {
  try {
    const r = await fetch(pdfUrl, { headers: { "user-agent": USER_AGENT } });
    if (!r.ok) return { stored: false, sizeBytes: null, sha256: null };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.subarray(0, 5).toString() !== "%PDF-") return { stored: false, sizeBytes: null, sha256: null };
    if (buf.length > MAX_PDF_MB * 1024 * 1024) return { stored: false, sizeBytes: buf.length, sha256: null };
    const sha = createHash("sha256").update(buf).digest("hex");
    const dupe = await prisma.leaflet.findFirst({
      where: { countryCode: cc.code, sha256: sha, flyerId: { not: flyerId } },
      select: { id: true },
    });
    if (dupe) return { stored: false, sizeBytes: buf.length, sha256: sha };
    const dir = path.join(dataDir(), "leaflets", cc.code);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${flyerId}.pdf`), buf);
    return { stored: true, sizeBytes: buf.length, sha256: sha };
  } catch {
    return { stored: false, sizeBytes: null, sha256: null };
  }
}

export type LeafletSummary = {
  countries: number;
  found: number;
  archived: number;
  errors: number;
};

export async function fetchLeaflets(
  opts: { countries?: string[]; downloadPdf?: boolean } = {},
): Promise<LeafletSummary> {
  const downloadPdf = opts.downloadPdf ?? process.env.ARCHIVE_LEAFLET_PDF !== "0";
  const wanted = opts.countries?.map((c) => c.toUpperCase());
  const countries = COUNTRIES.filter((c) => c.enabled && (!wanted || wanted.includes(c.code)));

  let found = 0;
  let archived = 0;
  let errors = 0;

  for (const cc of countries) {
    const cards = await discoverCountry(cc);
    if (!cards.length) {
      errors++;
      continue;
    }
    const limited = cards.slice(0, MAX_PER_COUNTRY);
    for (const card of limited) {
      try {
        const meta = await (async () => {
          const raw = await fetchText(`${FLYER_API}?flyer_identifier=${card.flyerId}`);
          if (!raw) return null;
          try {
            return (JSON.parse(raw).flyer ?? null) as Record<string, unknown> | null;
          } catch {
            return null;
          }
        })();
        await sleep(DELAY_MS);

        const name = String(meta?.name ?? card.name) || card.name;
        const title = meta?.title != null ? String(meta.title) : null;
        const validFrom = meta?.startDate ? new Date(String(meta.startDate)) : null;
        const validUntil = meta?.endDate ? new Date(String(meta.endDate)) : null;
        const coverUrl = meta?.thumbnailUrl ? String(meta.thumbnailUrl) : card.coverUrl;
        const pdfUrl = meta?.pdfUrl ? String(meta.pdfUrl) : null;
        const viewUrl = meta?.flyerUrlAbsolute ? String(meta.flyerUrlAbsolute) : null;
        const pages = typeof meta?.pages === "number" ? meta.pages : null;

        const spanDays =
          validFrom && validUntil && !isNaN(validFrom.getTime()) && !isNaN(validUntil.getTime())
            ? (validUntil.getTime() - validFrom.getTime()) / 86400000
            : 0;
        if (spanDays > MAX_VALIDITY_DAYS) {
          await sleep(DELAY_MS);
          continue;
        }
        found++;

        const existing = await prisma.leaflet.findUnique({ where: { flyerId: card.flyerId } });
        const needsPdf = downloadPdf && pdfUrl && !existing?.pdfStored;

        const dl = needsPdf && pdfUrl ? await storePdf(card.flyerId, cc, pdfUrl) : { stored: false, sizeBytes: null, sha256: null };
        if (dl.stored) archived++;

        const row = {
          name,
          title,
          validFrom: validFrom && !isNaN(validFrom.getTime()) ? validFrom : null,
          validUntil: validUntil && !isNaN(validUntil.getTime()) ? validUntil : null,
          coverUrl,
          pdfUrl,
          viewUrl,
          pages,
          ...(dl.sizeBytes != null ? { sizeBytes: dl.sizeBytes } : {}),
          ...(dl.sha256 ? { sha256: dl.sha256 } : {}),
          ...(dl.stored ? { pdfStored: true, archivedAt: new Date() } : {}),
        };

        await prisma.leaflet.upsert({
          where: { flyerId: card.flyerId },
          update: { ...row, fetchedAt: new Date() },
          create: { countryCode: cc.code, flyerId: card.flyerId, ...row },
        });
      } catch {
        errors++;
      }
    }
    await sleep(DELAY_MS);
  }

  return { countries: countries.length, found, archived, errors };
}
