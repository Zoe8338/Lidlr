// One command that checks every product and repairs whatever is missing:
//   - missing English titles       -> batch translation backfill
//   - missing description/specs    -> product-page fetch + parse + translate
//   - missing manuals              -> product-page crawl + PDF archive
//   - foreign (non-own-brand) rows -> report only; add --prune to delete them
//
//   npm run repair                 full pass over everything missing
//   npm run repair -- --limit=500  cap the per-phase product count
//   npm run repair -- --prune      also delete foreign products (and their listings/snapshots)
import spawn from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.slice(2).split("=");
    return [k, v === undefined ? true : v];
  })
);
const LIMIT = args.limit ? Number(args.limit) : 1e9;
const PRUNE = Boolean(args.prune);
const here = fileURLToPath(new URL("../", import.meta.url));
const run = (s, a) =>
  new Promise((resolve) => {
    const r = spawn.spawnSync("node", [s, ...a], { cwd: here, stdio: "inherit", env: process.env });
    resolve(r.status);
  });

console.log("=== repair: 1/4 foreign rows (report only; add --prune to delete) ===");
await run("scripts/prune.mjs", PRUNE ? ["--apply"] : []);

console.log("\n=== repair: 2/4 missing English titles ===");
const noEn = await prisma.product.count({ where: { titleEn: null } });
console.log(`products without an English title: ${noEn}`);
if (noEn) await run("scripts/translate.mjs", [Number.isFinite(LIMIT) ? `--limit=${Math.min(noEn, LIMIT)}` : "--limit=0"].filter((x) => !x.endsWith("limit=0")));

console.log("\n=== repair: 3/4 missing manuals, descriptions, specs ===");
const noDesc = await prisma.product.count({ where: { description: null } });
const noManual = await prisma.product.count({ where: { manualCheckedAt: null } });
console.log(`products without description: ${noDesc}, without manual check: ${noManual}`);
if (noDesc || noManual) {
  process.env.MANUAL_FETCH_PER_RUN = String(Number.isFinite(LIMIT) ? Math.min(noDesc + noManual, LIMIT) : 1e9);
  await run("scripts/manuals.mjs", []);
}

console.log("\n=== repair: 4/4 summary ===");
const after = {
  products: await prisma.product.count(),
  titlesEn: await prisma.product.count({ where: { titleEn: { not: null } } }),
  descriptions: await prisma.product.count({ where: { description: { not: null } } }),
  manuals: await prisma.manual.count(),
};
console.log(JSON.stringify(after, null, 2));
console.log("remaining without titleEn:", after.products - after.titlesEn, "| without description:", after.products - after.descriptions);
await prisma.$disconnect();
process.exit(0);
