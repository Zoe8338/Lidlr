import { runCrawl, evaluateTrackings } from "../src/lib/lidl/crawler.ts";
import { deliverPendingNotifications } from "../src/lib/notify.ts";
import { fetchLeaflets, evaluateLeafletOffers } from "../src/lib/leaflets.ts";

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
if (args.notify) {
  const notifications = await evaluateTrackings();
  const delivery = await deliverPendingNotifications();
  console.log("NOTIFICATIONS", { created: notifications, ...delivery });
}
if (args.leaflets) {
  const leaflets = await fetchLeaflets({ countries, downloadPdf: !args.nopdf });
  console.log("LEAFLET SUMMARY", JSON.stringify(leaflets));
  if (args.notify) {
    const n = await evaluateLeafletOffers();
    console.log("LEAFLET NOTIFICATIONS", n);
    await deliverPendingNotifications();
  }
}
process.exit(0);
