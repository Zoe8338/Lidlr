import { prisma } from "./db.ts";
import { runCrawl, evaluateTrackings } from "./lidl/crawler.ts";
import { COUNTRIES } from "./lidl/catalog.ts";
import { deliverPendingNotifications } from "./notify.ts";
import { fetchLeaflets, evaluateLeafletOffers } from "./leaflets.ts";
import { fetchManuals } from "./manuals.ts";

const TICK_MS = 10 * 60 * 1000;
const CRAWL_HOUR = Number(process.env.CRAWL_HOUR || 2); // local time of each shop
const MIN_GAP_MS = 22 * 3600 * 1000;
const LEAFLET_INTERVAL_MS = Number(process.env.LEAFLET_INTERVAL_MS || 12 * 3600 * 1000);

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

async function safe(name: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    const t0 = Date.now();
    const res = await fn();
    console.log(`[scheduler] ${name} ok in ${Date.now() - t0}ms`, res);
    return true;
  } catch (e) {
    console.error(`[scheduler] ${name} failed:`, e);
    return false;
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
const lastLeafletFetch = new Map<string, number>();
let lastLeaflets = 0;
let boot = true;
let busy = false;

async function tick() {
  if (busy) return;
  busy = true;
  try {
    // daily crawl per country once the shop's local time has reached CRAWL_HOUR.
    // "hour >= CRAWL_HOUR" keeps every country eligible until it has actually been
    // crawled, so a heavy night (13+ countries share CET) drains over successive
    // ticks (max 4 per tick) instead of being skipped after the 02:00-02:09 window.
    const due = COUNTRIES.filter(
      (c) =>
        c.enabled &&
        localHour(c.code) >= CRAWL_HOUR &&
        Date.now() - (lastCrawl.get(c.code) ?? 0) > MIN_GAP_MS,
    );
    if (due.length) console.log(`[scheduler] due for daily crawl: ${due.map((c) => c.code).join(",")}`);
    let crawled = 0;
    let offersDirty = false;
    for (const cc of due.slice(0, 4)) {
      const ok = await safe(`daily-crawl-${cc.code}`, () => runCrawl({ countries: [cc.code], source: "scheduled-daily" }));
      if (ok) lastCrawl.set(cc.code, Date.now());
      crawled += ok ? 1 : 0;
      // new weekly flyers usually appear at the same cadence as the drops —
      // refresh that country's leaflets right after its crawl (max every 12 h)
      if (ok && Date.now() - (lastLeafletFetch.get(cc.code) ?? 0) > LEAFLET_INTERVAL_MS) {
        lastLeafletFetch.set(cc.code, Date.now());
        await safe(`leaflets-${cc.code}`, () => fetchLeaflets({ countries: [cc.code] }));
        offersDirty = true;
      }
    }
    if (crawled) {
      await safe("track-eval", () => evaluateTrackings());
      await safe("notif-delivery", () => deliverPendingNotifications());
      await safe("manuals+descriptions", () => fetchManuals({ maxPerRun: 150 }));
    }
    if (offersDirty) {
      await safe("leaflet-offers", () => evaluateLeafletOffers());
      await safe("notif-delivery", () => deliverPendingNotifications());
    }
    if (boot) {
      // one full pass at start so a fresh deployment has everything immediately;
      // marks every country as crawled so the next ticks don't duplicate it.
      boot = false;
      const bootOk = await safe("boot-crawl", () => runCrawl({ source: "scheduled-boot" }));
      if (bootOk) for (const c of COUNTRIES.filter((c) => c.enabled)) lastCrawl.set(c.code, Date.now());
      await safe("track-eval", () => evaluateTrackings());
      await safe("notif-delivery", () => deliverPendingNotifications());
      await safe("leaflets", () => fetchLeaflets());
      await safe("leaflet-offers", () => evaluateLeafletOffers());
      await safe("notif-delivery-2", () => deliverPendingNotifications());
      await safe("manuals+descriptions", () => fetchManuals({ maxPerRun: 150 }));
      lastLeaflets = Date.now();
      for (const c of COUNTRIES.filter((c) => c.enabled)) lastLeafletFetch.set(c.code, Date.now());
    }
    // fallback leaflet refresh for anything the per-country path missed
    if (Date.now() - lastLeaflets > LEAFLET_INTERVAL_MS) {
      lastLeaflets = Date.now();
      await safe("leaflets-daily", () => fetchLeaflets());
      await safe("leaflet-offers", () => evaluateLeafletOffers());
      await safe("notif-delivery-3", () => deliverPendingNotifications());
    }
  } finally {
    busy = false;
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
