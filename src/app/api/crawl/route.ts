import { NextRequest, NextResponse } from "next/server";
import { runCrawl, evaluateTrackings } from "@/lib/lidl/crawler";
import { deliverPendingNotifications } from "@/lib/notify";
import { fetchLeaflets, evaluateLeafletOffers } from "@/lib/leaflets";

const SECRET = process.env.CRAWL_SECRET;

export async function POST(req: NextRequest) {
  if (SECRET && req.headers.get("x-crawl-secret") !== SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { countries?: string[]; brands?: string[]; maxItemsPerBrand?: number; alerts?: boolean; leaflets?: boolean } = {};
  try {
    body = await req.json();
  } catch {}
  try {
    const summary = await runCrawl(body);
    let notifications = 0;
    if (body.alerts !== false) {
      notifications = await evaluateTrackings();
      await deliverPendingNotifications();
    }
    let leafletSummary = null;
    let leafletNotifications = 0;
    if (body.leaflets === true) {
      leafletSummary = await fetchLeaflets({ countries: body.countries });
      leafletNotifications = await evaluateLeafletOffers();
      await deliverPendingNotifications();
    }
    return NextResponse.json({ ok: true, summary, notifications, leaflets: leafletSummary, leafletNotifications });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
