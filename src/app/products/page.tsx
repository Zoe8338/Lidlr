import Link from "next/link";
import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { BRANDS, COUNTRIES, SUB_LINES, matchesSubLine } from "@/lib/lidl/catalog";
import { ProductCard, type CardListing } from "@/components/ProductCard";
import { FilterButton, SortButton, ParamSelect, ViewToggle, BrandSubLine } from "@/components/Filters";
import { buildWhereForSearch, parsePriceOp, one, many } from "@/lib/search";
import { convert, fmtEur, fmtLocal, getFxRates } from "@/lib/fx";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Products — Lidlr",
  description:
    "Browse and search every tracked Lidl own-brand product — Parkside, Esmara, Crivit, Cien, SilverCrest, Livarno, Livery, Dentalux — with per-country prices in EUR. Filter by code, name, brand, category, price, offer and availability.",
};

const MAX_SCAN = 3000;

function tri(name: string, value: string) {
  return (
    <label className="field">
      <span>{name}</span>
      <select name={name} defaultValue={value || "unknown"}>
        <option value="unknown">Unknown</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}

type Sp = Record<string, string | string[] | undefined>;

export default async function Products({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const q = one(sp, "q")?.trim();
  const code = one(sp, "code")?.trim();
  const brands = many(sp, "brand");
  const subline = one(sp, "subline")?.trim() ?? "";
  const cats = many(sp, "cat");
  const country = one(sp, "country");
  const price = parsePriceOp(one(sp, "price"));
  const offer = one(sp, "offer") ?? "unknown";
  const online = one(sp, "online") ?? "unknown";
  const sortcol = ["name", "price", "date"].includes(one(sp, "sortcol") || "") ? one(sp, "sortcol")! : "date";
  const sortdir = (one(sp, "sortdir") || "desc") === "asc" ? "asc" : "desc";
  const view = one(sp, "view") === "cards" ? "cards" : "table";
  const ps = one(sp, "ps") ?? "24";
  const pageSize = ps === "all" ? MAX_SCAN : Math.max(10, Math.min(200, Number(ps) || 24));
  const page = Math.max(1, Number(one(sp, "page") || 1));

  const brandSlugs = brands.length ? BRANDS.filter((b) => brands.includes(b.family)).map((b) => b.slug) : undefined;

  const dbWhere = {
    removed: false,
    ...(brandSlugs ? { brandSlug: { in: brandSlugs } } : {}),
    ...(cats.length ? { category: { in: cats } } : {}),
    ...(code ? { erpNumber: { contains: code } } : {}),
    ...(buildWhereForSearch(q) ?? {}),
  };

  const [products, fx, catRows] = await Promise.all([
    prisma.product.findMany({
      where: dbWhere,
      include: { listings: true },
      orderBy: { lastSeen: "desc" },
      take: MAX_SCAN,
    }),
    getFxRates(),
    prisma.product.groupBy({
      by: ["category"],
      where: { removed: false, category: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { category: "desc" } },
      take: 60,
    }),
  ]);

  const rows = products.map((p) => {
    const listings = (country ? p.listings.filter((l) => l.countryCode === country) : p.listings).filter(
      (l) => l.currentPrice != null,
    );
    const priced = listings
      .map((l) => ({
        l,
        eur: fx ? (l.currency ? convert(l.currentPrice!, l.currency, "EUR", fx) : l.currentPrice) : l.currentPrice!,
      }))
      .filter((x): x is { l: (typeof listings)[number]; eur: number } => x.eur != null && Number.isFinite(x.eur));
    const best = priced.length ? priced.sort((a, b) => a.eur - b.eur)[0] : undefined;
    const onlineState = listings.some((l) => l.online) ? "yes" : listings.every((l) => l.online === false) ? "no" : "unknown";
    return { p, best, onlineState, inCountry: listings.length > 0 };
  });

  const scoped = country ? rows.filter((r) => r.inCountry) : rows;

  const afterSubline = subline && brands.length === 1
    ? scoped.filter(({ p }) => matchesSubLine(p.titleEn ? `${p.title} ${p.titleEn}` : p.title, p.brandName, subline, brands[0]))
    : scoped;

  const filtered = afterSubline.filter(({ best, onlineState }) => {
    if (offer === "yes" && !(best?.l.promo || best?.l.oldPrice)) return false;
    if (offer === "no" && (best?.l.promo || best?.l.oldPrice)) return false;
    if (online === "yes" && onlineState !== "yes") return false;
    if (online === "no" && onlineState === "yes") return false;
    if (price?.min != null && best && best.eur < price.min) return false;
    if (price?.max != null && best && best.eur > price.max) return false;
    return true;
  });

  const nameOf = (r: (typeof rows)[number]) => (r.p.titleEn ?? r.p.title).toLowerCase();
  const sorted = filtered.slice().sort((a, b) => {
    if (sortcol === "name") return sortdir === "asc" ? nameOf(a).localeCompare(nameOf(b)) : nameOf(b).localeCompare(nameOf(a));
    if (sortcol === "price") {
      const av = a.best?.eur ?? Infinity;
      const bv = b.best?.eur ?? Infinity;
      return sortdir === "asc" ? av - bv : bv - av;
    }
    const ad = new Date(a.p.lastSeen).getTime();
    const bd = new Date(b.p.lastSeen).getTime();
    return sortdir === "asc" ? ad - bd : bd - ad;
  });

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);

  const activeFilters =
    (q ? 1 : 0) +
    (code ? 1 : 0) +
    (brands.length ? 1 : 0) +
    (subline ? 1 : 0) +
    cats.length +
    (country ? 1 : 0) +
    (price ? 1 : 0) +
    (offer !== "unknown" ? 1 : 0) +
    (online !== "unknown" ? 1 : 0);

  const qs = (o: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
    return `/products?${p.toString()}`;
  };
  const stateParams = () => ({
    q,
    code,
    brand: brands.join(","),
    subline,
    cat: cats.join(","),
    country,
    price: one(sp, "price"),
    offer: offer === "unknown" ? "" : offer,
    online: online === "unknown" ? "" : online,
    sortcol,
    sortdir,
    view,
    ps,
  });

  return (
    <div>
      <h1 style={{ margin: "24px 0 4px" }}>Products</h1>
      <p style={{ color: "var(--muted)" }}>{total} products. Primary price is EUR; the local shop currency is in the Local column.</p>

      <div className="pp-bar">
        <form method="get" action="/products" className="pp-search">
          <input type="hidden" name="sortcol" value={sortcol} />
          <input type="hidden" name="sortdir" value={sortdir} />
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="ps" value={ps} />
          <input type="search" name="q" placeholder="Search name (screwdriver, wasserkocher…)" defaultValue={q || ""} aria-label="Search" />
          <button type="submit" className="pp-btn" aria-label="Search">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M11.7 10.3a6 6 0 1 0-1.4 1.4l3.5 3.5 1.4-1.4zM6.5 10.5a4 4 0 1 1 0-8 4 4 0 0 1 0 8" />
            </svg>
          </button>
        </form>
        <Suspense fallback={null}>
          <FilterButton active={activeFilters} hidden={{ view, ps }} resetParams={["sortcol", "sortdir", "view", "ps"]}>
            <BrandSubLine
              families={[...new Map(BRANDS.map((b) => [b.family, b])).keys()]}
              subLines={SUB_LINES}
              brand={brands[0] ?? ""}
              subline={subline}
            />
            <label className="field">
              <span>Country</span>
              <select name="country" defaultValue={country || ""}>
                <option value="">Any</option>
                {COUNTRIES.filter((c) => c.enabled).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </label>
            <details style={{ margin: "4px 0 10px" }}>
              <summary style={{ cursor: "pointer", color: "var(--muted)", fontWeight: 600, fontSize: 13 }}>
                More filters
              </summary>
              <div style={{ marginTop: 10 }}>
                <label className="field">
                  <span>Name</span>
                  <input type="text" name="q" defaultValue={q || ""} placeholder="any word, any language" />
                </label>
                <label className="field">
                  <span>Code (ERP)</span>
                  <input type="text" name="code" defaultValue={code || ""} placeholder="e.g. 100414316" />
                </label>
                <label className="field">
                  <span>Category (multiple)</span>
                  <select name="cat" multiple defaultValue={cats} size={6} className="cat-select">
                    {catRows.map((c) => (
                      <option key={c.category} value={c.category ?? ""}>
                        {c.category} ({c._count._all})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Price (EUR) — use &lt; or &gt; operators (e.g. &lt;100 or &gt;50)</span>
                  <input type="text" name="price" defaultValue={one(sp, "price") || ""} />
                </label>
                {tri("offer", offer)}
                {tri("online", online)}
              </div>
            </details>
          </FilterButton>
          <SortButton
            hidden={{ q, code, brand: brands.join(","), cat: cats.join(","), country, subline }}
            columns={[
              { value: "price", label: "Price (EUR)" },
              { value: "name", label: "Name" },
              { value: "date", label: "Date" },
            ]}
          />
          <ViewToggle view={view as "table" | "cards"} />
          <ParamSelect
            name="ps"
            value={ps}
            options={["24", "50", "100", "200", "all"].map((v) => ({ value: v, label: v === "all" ? "All" : v }))}
          />
        </Suspense>
      </div>

      {total === 0 ? (
        <div className="empty">
          Nothing found. Try broader words (search also understands German, French, Spanish, Italian and Portuguese
          terms), or kick off a crawl: <code>npm run crawl -- --countries=DE --max=200</code>.
        </div>
      ) : view === "cards" ? (
        <div className="grid">
          {pageRows.map(({ p, best }) => (
            <ProductCard key={p.erpNumber} product={p} listing={best?.l} />
          ))}
        </div>
      ) : (
        <div className="table-scroll">
          <table className="prices pp-table">
            <thead>
              <tr>
                <th>Image</th>
                <th>Code</th>
                <th>Name</th>
                <th>Brand</th>
                <th>Price (EUR)</th>
                <th>Local</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(({ p, best }) => (
                <tr key={p.erpNumber}>
                  <td>
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt="" loading="lazy" style={{ width: 44, height: 44, objectFit: "contain" }} />
                    ) : null}
                  </td>
                  <td className="pp-code">
                    <Link href={`/products/${p.erpNumber}`}>{p.erpNumber}</Link>
                  </td>
                  <td className="pp-name">
                    <Link href={`/products/${p.erpNumber}`}>{p.titleEn || p.title}</Link>
                  </td>
                  <td>{p.brandName || p.brandSlug || ""}</td>
                  <td className="cell-eur">{best ? fmtEur(best.eur) : "—"}</td>
                  <td className="cell-local">
                    {best && best.l.currency && best.l.currency !== "EUR" && best.l.currentPrice != null
                      ? fmtLocal(best.l.currentPrice, best.l.currency)
                      : ""}
                  </td>
                  <td>{fmtDate(p.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pager">
        {page > 1 ? (
          <Link className="button ghost" href={qs({ ...stateParams(), page: page - 1 })}>
            ‹ Previous
          </Link>
        ) : null}
        <span style={{ alignSelf: "center", color: "var(--muted)", fontSize: 13 }}>
          Page {page} / {totalPages}
        </span>
        {page < totalPages ? (
          <Link className="button ghost" href={qs({ ...stateParams(), page: page + 1 })}>
            Next ›
          </Link>
        ) : null}
      </div>
    </div>
  );
}
