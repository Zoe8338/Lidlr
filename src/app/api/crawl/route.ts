import { NextRequest, NextResponse } from "next/server";
import { runCrawl, checkAlerts } from "@/lib/lidl/crawler";

const SECRET = process.env.CRAWL_SECRET;

export async function POST(req: NextRequest) {
  if (SECRET && req.headers.get("x-crawl-secret") !== SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { countries?: string[]; brands?: string[]; maxItemsPerBrand?: number; alerts?: boolean } = {};
  try {
    body = await req.json();
  } catch {}
  try {
    const summary = await runCrawl(body);
    let alertsFired = 0;
    if (body.alerts !== false) alertsFired = await checkAlerts();
    return NextResponse.json({ ok: true, summary, alertsFired });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
