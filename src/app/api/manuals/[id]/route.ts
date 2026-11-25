import { NextResponse } from "next/server";
import { readManualFile } from "@/lib/manuals";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const manualId = Number(id);
  if (!Number.isInteger(manualId)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const file = await readManualFile(manualId);
  if (!file) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const safeName = file.title.replace(/[^A-Za-z0-9 ._-]/g, "_").slice(0, 80) || "manual";
  return new NextResponse(new Uint8Array(file.buf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${safeName}.pdf"`,
      "cache-control": "public, max-age=86400",
    },
  });
}
