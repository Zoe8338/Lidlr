import { prisma } from "@/lib/db";
import { ProductCard } from "@/components/ProductCard";
import { COUNTRIES } from "@/lib/lidl/catalog";

export const dynamic = "force-dynamic";

export default async function Deals({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const sp = await searchParams;
  const country = sp.country;

  const listings = await prisma.listing.findMany({
    where: {
      ...(country ? { countryCode: country } : {}),
      OR: [{ promo: { not: null } }, { oldPrice: { not: null } }],
      currentPrice: { not: null },
    },
    include: { product: true },
    orderBy: { priceUpdatedAt: "desc" },
    take: 120,
  });

  return (
    <div>
      <h1 style={{ margin: "24px 0 4px" }}>Deals & weekly promotions</h1>
      <p style={{ color: "var(--muted)" }}>
        {listings.length} listings currently flagged as deal of the day, flash sale, promo ribbon or discounted
        (old price → current price).
      </p>
      <form className="toolbar" method="get">
        <select name="country" defaultValue={country || ""}>
          <option value="">All countries</option>
          {COUNTRIES.filter((c) => c.enabled).map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="submit">Filter</button>
      </form>
      {listings.length === 0 ? (
        <div className="empty">No deals captured yet — run the crawler, then re-check.</div>
      ) : (
        <div className="grid">
          {listings.map((l) => (
            <ProductCard key={l.id} product={l.product} listing={l} />
          ))}
        </div>
      )}
    </div>
  );
}
