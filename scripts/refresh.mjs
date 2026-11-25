// One command to crawl Lidl and then import ParkPrice product metadata.
//
//   npm run refresh -- --countries=DE,AT,PT --max=100
//
// Flags are forwarded to the crawl (countries, brands, max, alerts, notify,
// manuals, leaflets, ...). ParkPrice-specific flags use a pp- prefix and are
// passed to `parkprice` (--pp-max=500 -> --max=500, --pp-delay=5000,
// --pp-offset, --pp-refetch, --pp-dry-run). Use --no-parkprice for crawl only.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const crawlOnly = args.includes("--no-parkprice");
const crawlArgs = args.filter((a) => !a.startsWith("--pp-"));
const ppArgs = args.filter((a) => a.startsWith("--pp-")).map((a) => `--${a.slice(5)}`);

const here = fileURLToPath(new URL("../", import.meta.url));

console.log("[refresh] 1/2 crawl\n");
const crawl = spawnSync("node", ["scripts/crawl.mjs", ...crawlArgs], { cwd: here, stdio: "inherit" });
if (crawl.status !== 0) console.error(`[refresh] crawl exited with ${crawl.status}`);

if (crawlOnly) process.exit(0);

console.log("\n[refresh] 2/2 parkprice import\n");
const pp = spawnSync("node", ["scripts/parkprice.mjs", ...ppArgs], { cwd: here, stdio: "inherit" });
if (pp.status !== 0) console.error(`[refresh] parkprice exited with ${pp.status}`);
