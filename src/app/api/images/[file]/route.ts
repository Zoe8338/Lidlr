import { readStoredImage } from "@/lib/images";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  const { file } = await params;
  const img = readStoredImage(file);
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(img.body as unknown as BodyInit, {
    headers: {
      "content-type": img.type,
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
