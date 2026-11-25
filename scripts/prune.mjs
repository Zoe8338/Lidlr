// Remove products crawled in before brand filtering — sponsored search results
// brought in unrelated brands (food, third-party names). A product is kept
// only when its brand name or title mentions a tracked Lidl own-brand family
// (parkside, esmara, crivit, livery/livergy, cien, silvercrest, dentalux,
// livarno). Dry run by default; add --apply to delete.
//
//   npm run prune            preview what would be deleted
//   npm run prune -- --apply delete for real
import { PrismaClient } from "@prisma/client";
import { inFamily } from "../src/lib/lidl/catalog.ts";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const FAMILIES = ["parkside", "esmara", "crivit", "livery", "cien", "silvercrest", "dentalux", "livarno"];

const isOwn = (p) =>
  FAMILIES.some((f) => inFamily(f, p.brandName, [p.title, p.titleEn].filter(Boolean).join(" ")));

const products = await prisma.product.findMany({
  select: { erpNumber: true, brandName: true, title: true, titleEn: true },
});
const drop = products.filter((p) => !isOwn(p));

const byBrand = {};
for (const p of drop) {
  const k = p.brandName || "(no brand)";
  byBrand[k] = (byBrand[k] ?? 0) + 1;
}

console.log(`products: ${products.length}  keep: ${products.length - drop.length}  remove: ${drop.length}`);
console.log(Object.entries(byBrand).map(([b, c]) => `${b}=${c}`).join(", ") || "(nothing foreign)");

if (!APPLY) {
  console.log("dry run — re-run with --apply to delete.");
} else if (drop.length) {
  let deleted = 0;
  for (let i = 0; i < drop.length; i += 500) {
    const chunk = drop.slice(i, i + 500);
    const erps = chunk.map((p) => p.erpNumber);
    await prisma.snapshot.deleteMany({ where: { listing: { erpNumber: { in: erps } } } });
    await prisma.listing.deleteMany({ where: { erpNumber: { in: erps } } });
    await prisma.tracking.deleteMany({ where: { erpNumber: { in: erps } } });
    await prisma.notification.deleteMany({ where: { erpNumber: { in: erps } } });
    await prisma.manual.deleteMany({ where: { erpNumber: { in: erps } } });
    const r = await prisma.product.deleteMany({ where: { erpNumber: { in: erps } } });
    deleted += r.count;
  }
  console.log(`deleted: ${deleted}`);
}

await prisma.$disconnect();
process.exit(0);
