import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";

const BASE = () => (process.env.SITE_URL || "http://localhost:3000").replace(/\/$/, "");

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = BASE();
  const staticRoutes: MetadataRoute.Sitemap = ["", "/products", "/deals", "/new", "/archive", "/privacy", "/cookies", "/terms"].map(
    (path) => ({ url: `${base}${path}`, changeFrequency: "weekly", priority: path === "" ? 1 : 0.7 }),
  );
  const products = await prisma.product.findMany({
    where: { removed: false },
    orderBy: { lastSeen: "desc" },
    take: 5000,
    select: { erpNumber: true, lastSeen: true },
  });
  return [
    ...staticRoutes,
    ...products.map((p) => ({
      url: `${base}/products/${p.erpNumber}`,
      lastModified: p.lastSeen,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
