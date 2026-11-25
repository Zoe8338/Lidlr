import { prisma } from "./db.ts";
import { runCrawl, evaluateTrackings } from "./lidl/crawler.ts";
import { COUNTRIES } from "./lidl/catalog.ts";
import { deliverPendingNotifications } from "./notify.ts";
import { fetchLeaflets, evaluateLeafletOffers } from "./leaflets.ts";
import { fetchManuals } from "./manuals.ts";

const TICK_MS = 10 * 60 * 1000;
const CRAWL_HOUR = Number(process.env.CRAWL_HOUR || 2); // local time of each shop
const MIN_GAP_MS = 22 * 3600 * 1000;

const TZ: Record<string, string> = {
  DE: "Europe/Berlin", AT: "Europe/Vienna", FR: "Europe/Paris", IT: "Europe/Rome",
  ES: "Europe/Madrid", PT: "Europe/Lisbon", NL: "Europe/Amsterdam", BE: "Europe/Brussels",
  PL: "Europe/Warsaw", CZ: "Europe/Prague", SK: "Europe/Bratislava", HU: "Europe/Budapest",
  RO: "Europe/Bucharest", BG: "Europe/Sofia", GR: "Europe/Athens", IE: "Europe/Dublin",
  HR: "Europe/Zagreb", SI: "Europe/Ljubljana", FI: "Europe/Helsinki", SE: "Europe/Stockholm",
  DK: "Europe/Copenhagen", LT: "Europe/Vilnius", LV: "Europe/Riga", EE: "Europe/Tallinn",
  CY: "Asia/Nicosia", LU: "Europe/Luxembourg", MT: "Europe/Malta", CH: "Europe/Zurich",
  GB: "Europe/London",
};

async function safe(name: string, fn: () => Promise<unknown>) {
  try {
    const t0 = Date.now();
    const res = await fn();
    console.log(`[scheduler] ${name} ok in ${Date.now() - t0}ms`, res);
  } catch (e) {
    console.error(`[scheduler] ${name} failed:`, e);
  }
}

function localHour(cc: string): number {
  try {
    return Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ[cc] ?? "UTC", hour: "2-digit", hour12: false }).format(new Date()));
  } catch {
    return new Date().getUTCHours();
  }
}

const lastCrawl = new Map<string, number>();
let lastLeaflets = 0;
let boot = true;

async function tick() {
  // daily crawl per country when the shop's local hour is CRAWL_HOUR
  const due = COUNTRIES.filter(
    (c) => c.enabled && localHour(c.code) === CRAWL_HOUR && Date.now() - (lastCrawl.get(c.code) ?? 0) > MIN_GAP_MS,
  );
  let crawled = false;
  for (const cc of due.slice(0, 4)) {
    await safe(`daily-crawl-${cc.code}`, () => runCrawl({ countries: [cc.code], source: "scheduled-daily" }));
    lastCrawl.set(cc.code, Date.now());
    crawled = true;
  }
  if (crawled) {
    await safe("track-eval", () => evaluateTrackings());
    await safe("notif-delivery", () => deliverPendingNotifications());
    await safe("manuals+descriptions", () => fetchManuals({ maxPerRun: 150 }));
  }
  if (boot) {
    // one full pass at start so a fresh deployment has everything immediately
    boot = false;
    await safe("boot-crawl", () => runCrawl({ source: "scheduled-boot" }));
    await safe("track-eval", () => evaluateTrackings());
    await safe("notif-delivery", () => deliverPendingNotifications());
    await safe("leaflets", () => fetchLeaflets());
    await safe("leaflet-offers", () => evaluateLeafletOffers());
    await safe("notif-delivery-2", () => deliverPendingNotifications());
    await safe("manuals+descriptions", () => fetchManuals({ maxPerRun: 150 }));
    lastLeaflets = Date.now();
  }
  // leaflets once a day, in the hour after the crawls
  if (Date.now() - lastLeaflets > 24 * 3600 * 1000) {
    lastLeaflets = Date.now();
    await safe("leaflets-daily", () => fetchLeaflets());
    await safe("leaflet-offers", () => evaluateLeafletOffers());
    await safe("notif-delivery-3", () => deliverPendingNotifications());
  }
}

export function startScheduler() {
  if (process.env.SCHEDULER_DISABLED === "1") return;
  void prisma.$queryRaw`SELECT 1`.catch(() => null);
  setTimeout(() => {
    void tick();
    setInterval(tick, TICK_MS);
  }, 60 * 1000);
}
