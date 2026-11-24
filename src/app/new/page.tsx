import { prisma } from "@/lib/db";
import { ProductCard } from "@/components/ProductCard";
import { BRANDS } from "@/lib/lidl/catalog";

export const dynamic = "force-dynamic";

export default async function NewItems({ searchParams }: { searchParams: Promise<{ days?: string; brand?: string }> }) {
  const sp = await searchParams;
  const days = Math.min(90, Math.max(1, Number(sp.days || 14)));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const family = BRANDS.find((b) => b.family === sp.brand);
  const brandSlugs = family ? BRANDS.filter((b) => b.family === sp.brand).map((b) => b.slug) : undefined;

  const products = await prisma.product.findMany({
    where: { firstSeen: { gte: since }, removed: false, ...(brandSlugs ? { brandSlug: { in: brandSlugs } } : {}) },
    include: { listings: true },
    orderBy: { firstSeen: "desc" },
    take: 120,
  });

  return (
    <div>
      <h1 style={{ margin: "24px 0 4px" }}>New items</h1>
      <p style={{ color: "var(--muted)" }}>{products.length} products first seen in the last {days} days.</p>
      <form className="toolbar" method="get">
        <select name="days" defaultValue={String(days)}>
          {[7, 14, 30, 90].map((d) => (
            <option key={d} value={d}>
              Last {d} days
            </option>
          ))}
        </select>
        <select name="brand" defaultValue={sp.brand || ""}>
          <option value="">All brands</option>
          {[...new Map(BRANDS.map((b) => [b.family, b])).keys()].map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button type="submit">Filter</button>
      </form>
      {products.length === 0 ? (
        <div className="empty">No new items in this window yet.</div>
      ) : (
        <div className="grid">
          {products.map((p) => {
            const l = p.listings.find((x) => x.currentPrice != null) ?? p.listings[0];
            return <ProductCard key={p.erpNumber} product={p} listing={l} />;
          })}
        </div>
      )}
    </div>
  );
}
