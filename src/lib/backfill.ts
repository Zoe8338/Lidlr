// Title backfill — the translation pass that runs AFTER crawls (decoupled by
// design: crawling stores originals fast and never waits on a provider).
// Fills Product.titleEn for anything still untranslated; safe to run as often
// as wanted (only rows with titleEn NULL are touched, providers are only hit
// for rows that actually need work).
import { prisma } from "./db.ts";
import { translateTitles, translationEnabled } from "./translate.ts";

const CHUNK = 80; // -> 8 provider requests of 10 lines each (translate.ts batches)

export type BackfillSummary = { total: number; done: number; failed: number };

export async function backfillTitles(opts: { max?: number } = {}): Promise<BackfillSummary> {
  const total = await prisma.product.count({ where: { titleEn: null } });
  const summary: BackfillSummary = { total, done: 0, failed: 0 };
  if (!total || !translationEnabled()) return summary;

  const take = Math.min(total, opts.max ?? Number(process.env.TRANSLATE_BACKFILL_PER_RUN || 500));
  const products = await prisma.product.findMany({
    where: { titleEn: null },
    select: { erpNumber: true, title: true },
    orderBy: { lastSeen: "desc" },
    take,
  });

  for (let i = 0; i < products.length; i += CHUNK) {
    const chunk = products.slice(i, i + CHUNK);
    const map = await translateTitles(chunk.map((p) => p.title));
    for (const p of chunk) {
      const en = map.get(p.title);
      if (!en) {
        summary.failed++;
        continue;
      }
      await prisma.product.update({ where: { erpNumber: p.erpNumber }, data: { titleEn: en } }).catch(() => null);
      summary.done++;
    }
    if (i + CHUNK < products.length) await new Promise((r) => setTimeout(r, 1500));
  }
  return summary;
}
