import { fetchLeaflets, evaluateLeafletOffers } from "../src/lib/leaflets.ts";
import { deliverPendingNotifications } from "../src/lib/notify.ts";

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.slice(2).split("=");
    return [k, v === undefined ? true : v];
  })
);

const countries = args.countries ? String(args.countries).split(",") : undefined;
const summary = await fetchLeaflets({ countries, downloadPdf: !args.nopdf });
console.log("LEAFLET SUMMARY", JSON.stringify(summary));
if (args.notify) {
  const n = await evaluateLeafletOffers();
  console.log("LEAFLET NOTIFICATIONS", n);
  await deliverPendingNotifications();
}
process.exit(0);
