import Link from "next/link";
import { prisma } from "@/lib/db";
import { BRANDS, COUNTRIES } from "@/lib/lidl/catalog";
import { ProductCard } from "@/components/ProductCard";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

export default async function Products({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; brand?: string; country?: string; page?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim();
  const brand = sp.brand;
  const country = sp.country;
  const page = Math.max(1, Number(sp.page || 1));
  const sort = sp.sort === "price_asc" || sp.sort === "price_desc" ? sp.sort : "relevance";

  const family = BRANDS.find((b) => b.family === brand);
  const brandSlugs = family ? BRANDS.filter((b) => b.family === brand).map((b) => b.slug) : undefined;

  const where = {
    removed: false,
    ...(brandSlugs ? { brandSlug: { in: brandSlugs } } : {}),
    ...(q ? { title: { contains: q } } : {}),
  };

  const listingsWhere = country ? { countryCode: country } : {};

  const total = await prisma.product.count({ where });

  const products = await prisma.product.findMany({
    where,
    include: { listings: { where: listingsWhere } },
    orderBy: sort === "relevance" ? { lastSeen: "desc" } : { lastSeen: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  const rows = products
    .map((p) => {
      const listings = p.listings.filter((l) => l.currentPrice != null);
      const best = listings.sort((a, b) => a.currentPrice! - b.currentPrice!)[0] ?? p.listings[0];
      return { p, best: best as (typeof p.listings)[number] | undefined };
    })
    .sort((a, b) => {
      if (sort === "price_asc") return (a.best?.currentPrice ?? Infinity) - (b.best?.currentPrice ?? Infinity);
      if (sort === "price_desc") return (b.best?.currentPrice ?? -1) - (a.best?.currentPrice ?? -1);
      return 0;
    });

  const qs = (o: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
    return `/products?${p.toString()}`;
  };

  return (
    <div>
      <h1 style={{ margin: "24px 0 4px" }}>Products</h1>
      <p style={{ color: "var(--muted)" }}>{total} products tracked. Price shown is the cheapest country listing.</p>

      <form className="toolbar" method="get">
        <input name="q" placeholder="Search title (e.g. screwdriver, casque, kettle)" defaultValue={q || ""} />
        <select name="brand" defaultValue={brand || ""}>
          <option value="">All brands</option>
          {[...new Map(BRANDS.map((b) => [b.family, b])).keys()].map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <select name="country" defaultValue={country || ""}>
          <option value="">All countries</option>
          {COUNTRIES.filter((c) => c.enabled).map((c) => (
            <option key={c.code} value={c.code}>
              {c.name} ({c.code})
            </option>
          ))}
        </select>
        <select name="sort" defaultValue={sort}>
          <option value="relevance">Newest first</option>
          <option value="price_asc">Price: low → high</option>
          <option value="price_desc">Price: high → low</option>
        </select>
        <button type="submit">Filter</button>
      </form>

      {total === 0 ? (
        <div className="empty">
          Nothing found. Kick off a crawl: <code>npm run crawl -- --countries=DE --max=200</code> or POST to
          /api/crawl.
        </div>
      ) : (
        <div className="grid">
          {rows.map(({ p, best }) => (
            <ProductCard key={p.erpNumber} product={p} listing={best} />
          ))}
        </div>
      )}

      <div className="pager">
        {page > 1 ? (
          <Link className="button ghost" href={qs({ q, brand, country, sort, page: page - 1 })}>
            ‹ Previous
          </Link>
        ) : null}
        {page * PAGE_SIZE < total ? (
          <Link className="button ghost" href={qs({ q, brand, country, sort, page: page + 1 })}>
            Next ›
          </Link>
        ) : null}
      </div>
    </div>
  );
}
