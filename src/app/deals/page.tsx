import Link from "next/link";
import { prisma } from "@/lib/db";
import { BRANDS, COUNTRIES } from "@/lib/lidl/catalog";
import { ProductCard } from "@/components/ProductCard";
import { convert, getFxRates } from "@/lib/fx";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Weekly deals & promotions — Lidlr",
  description:
    "All current weekly in-store deals for Lidl own brands across EU countries: Parkside, Crivit, Esmara, SilverCrest, Livarno, Cien and more — with prices in EUR.",
};

const PAGE_SIZE = 24;
const MAX_SCAN = 3000;

export default async function Deals({
  searchParams,
}: {
  searchParams: Promise<{ country?: string; brand?: string; sort?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const country = sp.country;
  const page = Math.max(1, Number(sp.page || 1));
  const sort = ["newest", "discount", "price_asc", "price_desc"].includes(sp.sort || "") ? sp.sort! : "newest";

  const family = BRANDS.find((b) => b.family === sp.brand);
  const brandSlugs = family ? BRANDS.filter((b) => b.family === sp.brand).map((b) => b.slug) : undefined;

  const [fx, all] = await Promise.all([
    getFxRates(),
    prisma.listing.findMany({
      where: {
        currentPrice: { not: null },
        OR: [{ promo: { not: null } }, { oldPrice: { not: null } }],
        ...(country ? { countryCode: country } : {}),
        ...(brandSlugs ? { product: { brandSlug: { in: brandSlugs } } } : {}),
      },
      include: { product: true },
      orderBy: { priceUpdatedAt: "desc" },
      take: MAX_SCAN,
    }),
  ]);

  const rows = all
    .map((l) => {
      const eur = fx && l.currency ? convert(l.currentPrice!, l.currency, "EUR", fx) : l.currentPrice;
      const eurWas = l.oldPrice != null && fx && l.currency ? convert(l.oldPrice, l.currency, "EUR", fx) : l.oldPrice;
      const discount = eur != null && eurWas != null && eurWas > 0 ? Math.round(((eurWas - eur) / eurWas) * 100) : null;
      return { l, discount };
    })
    .sort((a, b) => {
      if (sort === "discount") {
        if (a.discount != null && b.discount != null) return b.discount - a.discount;
        if (a.discount != null) return -1;
        if (b.discount != null) return 1;
        return 0;
      }
      if (sort === "price_asc" || sort === "price_desc") {
        const av = a.l.currentPrice ?? 0;
        const bv = b.l.currentPrice ?? 0;
        return sort === "price_asc" ? av - bv : bv - av;
      }
      return 0;
    });

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const qs = (o: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
    return `/deals?${p.toString()}`;
  };
  const extraParams = { country, brand: sp.brand, sort };

  return (
    <div>
      <h1 style={{ margin: "24px 0 4px" }}>Deals &amp; weekly promotions</h1>
      <p style={{ color: "var(--muted)" }}>
        {total} current in-store deals across all crawled countries — promo ribbons, leaflet offers and price drops
        (old price → current price). Browse everything with the pager below.
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
        <select name="brand" defaultValue={sp.brand || ""}>
          <option value="">All brands</option>
          {[...new Map(BRANDS.map((b) => [b.family, b])).keys()].map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select name="sort" defaultValue={sort}>
          <option value="newest">Newest first</option>
          <option value="discount">Biggest discount %</option>
          <option value="price_asc">Price: low → high</option>
          <option value="price_desc">Price: high → low</option>
        </select>
        <button type="submit">Filter</button>
      </form>

      {total === 0 ? (
        <div className="empty">No deals captured yet — run the crawler, then re-check.</div>
      ) : (
        <>
          <div className="grid">
            {pageRows.map(({ l, discount }) => (
              <div key={`${l.countryCode}-${l.erpNumber}`}>
                {discount ? <span className="discount-badge">-{discount}%</span> : null}
                <ProductCard product={l.product} listing={l} />
              </div>
            ))}
          </div>
          <div className="pager">
            {page > 1 ? (
              <Link className="button ghost" href={qs({ ...extraParams, page: page - 1 })}>
                ‹ Previous
              </Link>
            ) : null}
            <span style={{ alignSelf: "center", color: "var(--muted)", fontSize: 13 }}>
              Page {page} / {totalPages}
            </span>
            {page < totalPages ? (
              <Link className="button ghost" href={qs({ ...extraParams, page: page + 1 })}>
                Next ›
              </Link>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
