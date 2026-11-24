import { runCrawl, checkAlerts } from "../src/lib/lidl/crawler.ts";

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.slice(2).split("=");
    return [k, v === undefined ? true : v];
  })
);

const countries = args.countries ? String(args.countries).split(",") : undefined;
const brands = args.brands ? String(args.brands).split(",") : undefined;
const maxItemsPerBrand = args.max ? Number(args.max) : undefined;

const summary = await runCrawl({ countries, brands, source: "cli", maxItemsPerBrand });
console.log("CRAWL SUMMARY", summary);
if (args.alerts) console.log("ALERTS FIRED", await checkAlerts());
process.exit(0);
