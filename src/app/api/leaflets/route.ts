import { NextRequest, NextResponse } from "next/server";
import { fetchLeaflets } from "@/lib/leaflets";

const SECRET = process.env.CRAWL_SECRET;

export async function POST(req: NextRequest) {
  if (SECRET && req.headers.get("x-crawl-secret") !== SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: { countries?: string[]; downloadPdf?: boolean } = {};
  try {
    body = await req.json();
  } catch {}
  try {
    const summary = await fetchLeaflets(body);
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
