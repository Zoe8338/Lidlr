// CLI wrapper around src/lib/parkprice.ts:
//   npm run parkprice -- --probe=20         sample N pages, report stats, no DB writes
//   npm run parkprice -- --max=500          import at most N product pages
//   npm run parkprice -- --offset=500       resume point into the sitemap list
//   npm run parkprice -- --delay=5000       ms between requests (default 3000)
//   npm run parkprice -- --refetch          ignore cached pages from earlier runs
//   npm run parkprice -- --dry-run          parse + match, write nothing
//   npm run parkprice -- --targets=521608,https://www.park-price.com/en/product/...
//                                           import only these pages (URLs, slugs or IANs)
//   npm run parkprice -- --create-missing   create shell products (IAN-<ian>) for
//                                           pages whose IAN is not in the catalog yet
// The same import can be triggered from the admin dashboard (Jobs tab, plus a
// targeted-import and merge UI on the Products tab).
const { importParkPrice } = await import("../src/lib/parkprice.ts");

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=").slice(1).join("=") : dflt;
};
const has = (name) => args.includes(`--${name}`);
const probe = Number(arg("probe", "0")) || undefined;
const max = probe ?? Number(arg("max", "1e9"));
const targets = (arg("targets", "") || "")
  .split(/[,\s]+/)
  .map((t) => t.trim())
  .filter(Boolean);
const summary = await importParkPrice({
  max,
  offset: Number(arg("offset", "0")) || 0,
  delay: Number(arg("delay", targets.length ? "1500" : "3000")) || 3000,
  refetch: has("refetch"),
  dryRun: has("dry-run") || !!probe,
  targets: targets.length ? targets : undefined,
  createMissing: has("create-missing"),
});
console.log("PARKPRICE SUMMARY", JSON.stringify(summary));
process.exit(0);
