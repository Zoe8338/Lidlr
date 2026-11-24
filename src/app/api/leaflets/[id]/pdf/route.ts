import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) return new Response("Bad id", { status: 400 });

  const leaflet = await prisma.leaflet.findUnique({ where: { id: numericId } });
  if (!leaflet || !leaflet.pdfStored) return new Response("Not archived", { status: 404 });

  const file = path.resolve(process.env.DATA_DIR || "data", "leaflets", leaflet.countryCode, `${leaflet.flyerId}.pdf`);
  if (!fs.existsSync(file)) return new Response("Archived file missing", { status: 410 });

  const buf = fs.readFileSync(file);
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="lidlr-${leaflet.countryCode}-${leaflet.flyerId}.pdf"`,
      "cache-control": "public, max-age=86400",
    },
  });
}
