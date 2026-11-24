import { runCrawl, checkAlerts } from "./lidl/crawler.ts";
import { deliverPendingAlertEvents } from "./alerts.ts";

const WEEKLY_MS = 7 * 24 * 3600 * 1000;
const DAILY_MS = 24 * 3600 * 1000;

async function safe(name: string, fn: () => Promise<unknown>) {
  try {
    const t0 = Date.now();
    const res = await fn();
    console.log(`[scheduler] ${name} ok in ${Date.now() - t0}ms`, res);
  } catch (e) {
    console.error(`[scheduler] ${name} failed:`, e);
  }
}

export function startScheduler() {
  if (process.env.SCHEDULER_DISABLED === "1") return;
  void safe("weekly-crawl", () => runCrawl({ source: "scheduled-weekly" }));
  setTimeout(() => {
    const weekly = () => safe("weekly-crawl", () => runCrawl({ source: "scheduled-weekly" }));
    const daily = () =>
      (async () => {
        await safe("alert-check", async () => checkAlerts());
        await safe("alert-delivery", async () => deliverPendingAlertEvents());
      })();
    setInterval(weekly, WEEKLY_MS);
    setInterval(daily, DAILY_MS);
  }, 60 * 1000);
}
