import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "./db.ts";

// Product images are archived into DATA_DIR/images and served from the app
// (e.g. /api/images/<sha256>.jpeg) so they survive Lidl deleting products.
// Filenames are derived from the original URL: the first version ever fetched
// is kept — exactly the archival behaviour we want.

export const IMAGE_HOST_OK =
  /(^|\.)(lidl|schwarz|sit-connect)(\.[a-z.]+)?$/i;

const MAX_MB = Number(process.env.IMAGE_MAX_PDF_MB || 15) * 1024 * 1024;

export function imagesDir(): string {
  return path.resolve(process.env.DATA_DIR || "data", "images");
}

export function isLidlImage(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && IMAGE_HOST_OK.test(u.hostname);
  } catch {
    return false;
  }
}

const EXT = /\.(jpe?g|png|webp|gif|avif)(?=\\?|$)/i;

export function imageFileName(url: string): string {
  const sha = createHash("sha256").update(url).digest("hex");
  const m = url.match(EXT);
  return `${sha}.${(m?.[1] ?? "jpg").toLowerCase().replace("jpeg", "jpg")}`;
}

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif",
};

export function imageMime(name: string): string {
  return MIME[path.extname(name).toLowerCase()] ?? "image/jpeg";
}

// downloads + stores once; returns the file name or null
export async function archiveImage(url: string): Promise<string | null> {
  if (!url || !isLidlImage(url)) return null;
  const name = imageFileName(url);
  const file = path.join(imagesDir(), name);
  if (existsSync(file)) return name;
  try {
    const r = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; Lidlr/1.0)" },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX_MB) return null;
    mkdirSync(imagesDir(), { recursive: true });
    writeFileSync(file, buf);
    return name;
  } catch {
    return null;
  }
}

export function readStoredImage(name: string): { body: Uint8Array; type: string } | null {
  if (!/^[a-f0-9]{64}\.(jpg|jpeg|png|webp|gif|avif)$/i.test(name)) return null;
  const file = path.join(imagesDir(), name);
  if (!existsSync(file)) return null;
  try {
    return { body: new Uint8Array(readFileSync(file)), type: imageMime(name) };
  } catch {
    return null;
  }
}

function parseJsonList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// Remote archive URLs (imageUrl + images) aligned by index with the archived
// local files in storedImages (crawler/repair fill both in the same order).
export function productImageSrcs(p: {
  imageUrl?: string | null;
  images?: string | null;
  storedImages?: string | null;
}): string[] {
  const remote = [...new Set([p.imageUrl ?? null, ...parseJsonList(p.images)].filter((x): x is string => !!x))].slice(0, 4);
  const local = parseJsonList(p.storedImages);
  return remote.map((u, i) =>
    local[i] ? `/api/images/${local[i]}` : `/api/img?u=${encodeURIComponent(u)}`,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Backfill pass: archive images for every product that has none stored yet.
export async function fetchImages(
  opts: { maxPerRun?: number; countries?: string[] } = {},
): Promise<{ products: number; archived: number; errors: number }> {
  const cap = opts.maxPerRun ?? Number(process.env.IMAGE_FETCH_PER_RUN || 400);
  const products = await prisma.product.findMany({
    where: { storedImages: null },
    select: { erpNumber: true, imageUrl: true, images: true },
    orderBy: { lastSeen: "desc" },
    take: Number.isFinite(cap) ? cap : 400,
  });
  let archived = 0;
  let errors = 0;
  for (const p of products) {
    const urls = [...new Set([p.imageUrl, ...parseJsonList(p.images)].filter((x): x is string => !!x))].slice(0, 4);
    const files: string[] = [];
    for (const u of urls) {
      const f = await archiveImage(u);
      if (f) files.push(f);
      else errors++;
      await sleep(150);
    }
    const data = files.length ? JSON.stringify(files) : "";
    try {
      await prisma.product.update({ where: { erpNumber: p.erpNumber }, data: { storedImages: data } });
    } catch {
      errors++;
    }
    if (files.length) archived++;
  }
  return { products: products.length, archived, errors };
}
