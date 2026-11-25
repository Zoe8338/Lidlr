// Backfill English titles for products crawled before AUTO_TRANSLATE was on,
// or that no longer appear in live Lidl search results (so the crawler never
// revisits them). Only fills missing titleEn — never overwrites.
//
//   npm run translate             translate every product missing a title
//   npm run translate -- --limit=200
//   npm run translate -- --dry-run
//
// Requires AUTO_TRANSLATE=1 (set by default in docker-compose).
import { PrismaClient } from "@prisma/client";
import { translateTitles, translationEnabled } from "../src/lib/translate.ts";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=").slice(1).join("=") : dflt;
};
const LIMIT = Number(arg("limit", "1e9"));
const DRY = args.includes("--dry-run");

if (!translationEnabled()) {
  console.error("AUTO_TRANSLATE is not enabled — set AUTO_TRANSLATE=1. Nothing to do.");
  process.exit(1);
}

const total = await prisma.product.count({ where: { titleEn: null } });
console.log(`products without an English title: ${total}`);
if (!total) process.exit(0);

const take = Math.min(total, Number.isFinite(LIMIT) ? LIMIT : total);
const products = await prisma.product.findMany({
  where: { titleEn: null },
  select: { erpNumber: true, title: true },
  orderBy: { lastSeen: "desc" },
  take,
});

let updated = 0, untranslated = 0;
const CHUNK = 160;
for (let i = 0; i < products.length; i += CHUNK) {
  const chunk = products.slice(i, i + CHUNK);
  const map = await translateTitles(chunk.map((p) => p.title));
  if (DRY) {
    for (const p of chunk) console.log(`  ${p.erpNumber}  ${p.title.slice(0, 60)}  ->  ${map.get(p.title) ?? "(failed)"}`);
    continue;
  }
  await prisma.$transaction(
    chunk.map((p) => {
      const en = map.get(p.title);
      if (!en) untranslated++;
      return prisma.product.update({
        where: { erpNumber: p.erpNumber },
        data: { titleEn: en ?? undefined },
      });
    }),
  );
  updated += chunk.length;
  console.log(`  ${Math.min(i + CHUNK, products.length)}/${products.length} processed`);
  await new Promise((r) => setTimeout(r, 1500));
}

console.log(DRY ? `dry run done (${products.length} products sampled)` : `done. updated=${updated} left untranslated=${untranslated}`);
await prisma.$disconnect();
process.exit(0);
