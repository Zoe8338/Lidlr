// Double-check pass (24 h cadence, also `npm run reconcile`): re-translate a
// rotating batch of already-translated products through the primary Google
// endpoints and compare against what is stored. Whatever is wrong is fixed —
// stored value missing/empty, identical to the untranslated original, a
// LibreTranslate "LT:" artifact), or simply different from Google's output
// (Google is the reference). Values Google can not provide right now are left
// untouched and picked up by the next pass.
//
//   npm run reconcile                check 400 products
//   npm run reconcile -- --limit=100
//   npm run reconcile -- --dry-run
import { prisma } from "./db.ts";
import { batchRequestLines, translationEnabled } from "./translate.ts";

const CHUNK = 40;

// catalog offset of the next pass (rotates with each run)
let cursor = 0;

export interface ReconcileSummary {
  checked: number;
  fixedTitle: number;
  fixedDescription: number;
  fixedSpecs: number;
  failed: number;
  dryRun: boolean;
}

const norm = (s: string) =>
  s.toLowerCase().replace(/\s+/g, " ").replace(/[“”„«»"']/g, "").replace(/[.,;:!]+$/g, "").trim();

function fixFor(stored: string | null, original: string, googleEn: unknown): string | null {
  if (typeof googleEn !== "string" || !googleEn.trim()) return null;
  const t = (stored ?? "").trim();
  if (!t) return googleEn;
  if (norm(t) === norm(original)) return googleEn;
  if (/^\s*LT\s*:/i.test(t)) return googleEn;
  if (norm(t) !== norm(googleEn)) return googleEn;
  return null;
}

export async function reconcileTranslations(
  opts: { limit?: number; dryRun?: boolean } = {},
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = { checked: 0, fixedTitle: 0, fixedDescription: 0, fixedSpecs: 0, failed: 0, dryRun: !!opts.dryRun };
  if (!translationEnabled()) return summary;
  const limit = opts.limit ?? Number(process.env.RECONCILE_LIMIT || 400);
  if (!limit) return summary;

  const total = await prisma.product.count({ where: { titleEn: { not: null } } });
  if (!total) return summary;

  // rotate the window so every pass covers a different slice of the catalog
  const offset = cursor % total;
  const products = await prisma.product.findMany({
    where: { titleEn: { not: null } },
    select: { erpNumber: true, title: true, titleEn: true, description: true, descriptionEn: true, specs: true, specsEn: true },
    orderBy: { erpNumber: "asc" },
    skip: offset,
    take: Math.min(limit, total),
  });
  cursor = (offset + products.length) % total;

  for (let i = 0; i < products.length; i += CHUNK) {
    const chunk = products.slice(i, i + CHUNK);

    const titleOut = await batchRequestLines(chunk.map((p) => p.title.slice(0, 300)));
    const descChunk = chunk.filter((p) => (p.description ?? "").trim());
    const descOut = descChunk.length
      ? (await batchRequestLines(descChunk.map((p) => p.description!.slice(0, 1500))))?.map((s) => s?.slice(0, 2000) ?? null) ?? null
      : null;
    const specChunk = chunk.filter((p) => (p.specs ?? "").trim());
    const specOut = specChunk.length
      ? (await batchRequestLines(specChunk.map((p) => p.specs!.slice(0, 1500))))?.map((s) => s?.slice(0, 2000) ?? null) ?? null
      : null;

    const updates: { erpNumber: string; data: { titleEn?: string; descriptionEn?: string; specsEn?: string } }[] = [];
    chunk.forEach((p, k) => {
      summary.checked++;
      const data: { titleEn?: string; descriptionEn?: string; specsEn?: string } = {};
      const titleFix = fixFor(p.titleEn, p.title, titleOut?.[k]);
      if (titleFix) data.titleEn = titleFix;
      const di = descChunk.indexOf(p);
      if (di >= 0) {
        const dFix = fixFor(p.descriptionEn, p.description!, descOut?.[di]);
        if (dFix) data.descriptionEn = dFix;
      }
      const si = specChunk.indexOf(p);
      if (si >= 0) {
        const sFix = fixFor(p.specsEn, p.specs!, specOut?.[si]);
        if (sFix) data.specsEn = sFix;
      }
      if (Object.keys(data).length) updates.push({ erpNumber: p.erpNumber, data });
      if (!titleOut?.[k] && !p.description && !p.specs) summary.failed++;
    });

    if (summary.dryRun) {
      for (const u of updates) {
        const p = chunk.find((p) => p.erpNumber === u.erpNumber)!;
        console.log(`  fix ${u.erpNumber}: ${p.titleEn} -> ${u.data.titleEn ?? "(same)"}`);
      }
      summary.fixedTitle += updates.filter((u) => u.data.titleEn).length;
      summary.fixedDescription += updates.filter((u) => u.data.descriptionEn).length;
      summary.fixedSpecs += updates.filter((u) => u.data.specsEn).length;
    } else if (updates.length) {
      await prisma.$transaction(
        updates.map((u) => prisma.product.update({ where: { erpNumber: u.erpNumber }, data: u.data })),
      );
      summary.fixedTitle += updates.filter((u) => u.data.titleEn).length;
      summary.fixedDescription += updates.filter((u) => u.data.descriptionEn).length;
      summary.fixedSpecs += updates.filter((u) => u.data.specsEn).length;
    }
    if (i + CHUNK < products.length) await new Promise((r) => setTimeout(r, 1500));
  }
  return summary;
}

