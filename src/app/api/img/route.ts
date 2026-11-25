import { archiveImage, imageFileName, isLidlImage, readStoredImage } from "@/lib/images";

export const dynamic = "force-dynamic";

// Archiving image proxy: serves the stored copy of a Lidl product image
// (downloading it once if needed), so URLs keep working after Lidl deletes
// the product. Only whitelisted Lidl/Schwarz hosts are allowed.
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams.get("u");
  if (!u || !isLidlImage(u)) return new Response("Bad request", { status: 400 });
  const img = readStoredImage(imageFileName(u));
  if (img) {
    return new Response(img.body as unknown as BodyInit, {
      headers: { "content-type": img.type, "cache-control": "public, max-age=86400" },
    });
  }
  const name = await archiveImage(u);
  const stored = name ? readStoredImage(name) : null;
  if (stored) {
    return new Response(stored.body as unknown as BodyInit, {
      headers: { "content-type": stored.type, "cache-control": "public, max-age=31536000, immutable" },
    });
  }
  return Response.redirect(u, 307);
}
