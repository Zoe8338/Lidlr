import Link from "next/link";
import { prisma } from "@/lib/db";
import { BRANDS, COUNTRIES } from "@/lib/lidl/catalog";
import { ProductCard, type CardListing } from "@/components/ProductCard";
import { buildWhereForSearch } from "@/lib/search";
import { convert, getFxRates } from "@/lib/fx";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Products — Lidlr",
  description:
    "Browse and search every tracked Lidl own-brand product — Parkside, Esmara, Crivit, Cien, SilverCrest, Livarno, Livery, Dentalux — with per-country prices in EUR.",
};

const PAGE_SIZE = 24;
const MAX_SCAN = 3000;


async function fetchProducts(where: Record<string, unknown>) {
  return prisma.product.findMany({
    where,
    include: { listings: true },
    orderBy: { lastSeen: "desc" },
    take: MAX_SCAN,
  });
}

export default async function Products({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    brand?: string;
    country?: string;
    min?: string;
    max?: string;
    stock?: string;
    sale?: string;
    page?: string;
    sort?: string;
  }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim();
  const brand = sp.brand;
  const country = sp.country;
  const min = sp.min ? Number(sp.min) : null;
  const max = sp.max ? Number(sp.max) : null;
  const inStock = sp.stock === "1";
  const onSale = sp.sale === "1";
  const page = Math.max(1, Number(sp.page || 1));
  const sort = ["relevance", "price_asc", "price_desc", "name"].includes(sp.sort || "") ? sp.sort! : "relevance";

  const family = BRANDS.find((b) => b.family === brand);
  const brandSlugs = family ? BRANDS.filter((b) => b.family === brand).map((b) => b.slug) : undefined;

  const where = {
    removed: false,
    ...(brandSlugs ? { brandSlug: { in: brandSlugs } } : {}),
    ...(buildWhereForSearch(q) ?? {}),
  };

  const [products, fx] = await Promise.all([fetchProducts(where), getFxRates()]);

  const withEur = products.map((p) => {
    const listings = (country ? p.listings.filter((l) => l.countryCode === country) : p.listings).filter(
      (l) => l.currentPrice != null,
    );
    const best = listings
      .map((l) => ({
        l,
        eur: fx ? (l.currency ? convert(l.currentPrice!, l.currency, "EUR", fx) : l.currentPrice) : l.currentPrice!,
      }))
      .filter((x) => x.eur != null && Number.isFinite(x.eur))
      .sort((a, b) => a.eur! - b.eur!)[0];
    return { p, best: best?.l as CardListing | undefined, bestEur: best?.eur ?? null };
  });

  let rows = withEur;
  if (inStock) rows = rows.filter((r) => r.best?.stockOk);
  if (onSale) rows = rows.filter((r) => r.best?.promo || r.best?.oldPrice);
  if (min != null && Number.isFinite(min)) rows = rows.filter((r) => r.bestEur != null && r.bestEur >= min);
  if (max != null && Number.isFinite(max)) rows = rows.filter((r) => r.bestEur != null && r.bestEur <= max);
  if (sort === "price_asc") rows = [...rows].sort((a, b) => (a.bestEur ?? Infinity) - (b.bestEur ?? Infinity));
  else if (sort === "price_desc") rows = [...rows].sort((a, b) => (b.bestEur ?? -1) - (a.bestEur ?? -1));
  else if (sort === "name") rows = [...rows].sort((a, b) => (a.p.titleEn ?? a.p.title).localeCompare(b.p.titleEn ?? b.p.title));

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const qs = (o: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
    return `/products?${p.toString()}`;
  };
  const extraParams = { q, brand, country, min: sp.min, max: sp.max, stock: inStock ? "1" : "", sale: onSale ? "1" : "", sort };

  return (
    <div>
      <h1 style={{ margin: "24px 0 4px" }}>Products</h1>
      <p style={{ color: "var(--muted)" }}>
        {total} product{total === 1 ? "" : "s"} match your filters. Primary price is the EUR equivalent; the local
        shop currency is shown underneath.
      </p>

      <form className="toolbar" method="get">
        <input name="q" placeholder="Search: screwdriver, wasserkocher, aspirador…" defaultValue={q || ""} />
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
        <input type="number" step="0.01" min="0" name="min" placeholder="Min €" style={{ maxWidth: 110 }} defaultValue={sp.min || ""} />
        <input type="number" step="0.01" min="0" name="max" placeholder="Max €" style={{ maxWidth: 110 }} defaultValue={sp.max || ""} />
        <select name="sort" defaultValue={sort}>
          <option value="relevance">Newest first</option>
          <option value="name">Name A–Z</option>
          <option value="price_asc">Price: low → high</option>
          <option value="price_desc">Price: high → low</option>
        </select>
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" name="stock" value="1" defaultChecked={inStock} /> In stock
        </label>
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" name="sale" value="1" defaultChecked={onSale} /> On sale
        </label>
        <button type="submit">Filter</button>
      </form>

      {total === 0 ? (
        <div className="empty">
          Nothing found. Try broader words (search also understands German, French, Spanish, Italian and Portuguese
          terms), or kick off a crawl: <code>npm run crawl -- --countries=DE --max=200</code>.
        </div>
      ) : (
        <>
          <div className="grid">
            {pageRows.map(({ p, best }) => (
              <ProductCard key={p.erpNumber} product={p} listing={best} />
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
