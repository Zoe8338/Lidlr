import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { BRANDS } from "@/lib/lidl/catalog";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q");
  const brand = sp.get("brand");
  const family = BRANDS.find((b) => b.family === brand);
  const brandSlugs = family ? BRANDS.filter((b) => b.family === brand).map((b) => b.slug) : undefined;
  const take = Math.min(100, Number(sp.get("take") || 24));

  const products = await prisma.product.findMany({
    where: {
      removed: false,
      ...(brandSlugs ? { brandSlug: { in: brandSlugs } } : {}),
      ...(q ? { title: { contains: q } } : {}),
    },
    include: { listings: true },
    orderBy: { lastSeen: "desc" },
    take,
  });

  return NextResponse.json({ count: products.length, products });
}
