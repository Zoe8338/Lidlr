import Link from "next/link";
import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { BRANDS, COUNTRIES } from "@/lib/lidl/catalog";
import { ProductCard } from "@/components/ProductCard";
import { FilterButton, SortButton, ParamSelect, ViewToggle } from "@/components/Filters";
import { PageNumbers } from "@/components/Pager";
import { parsePriceOp, one, many } from "@/lib/search";
import { convert, fmtEur, fmtLocal, getFxRates } from "@/lib/fx";
import { fmtDate } from "@/lib/format";
import { productImageSrcs } from "@/lib/images";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Weekly deals & promotions — Lidlr",
  description:
    "All current weekly in-store deals for Lidl own brands across EU countries: Parkside, Crivit, Esmara, SilverCrest, Livarno, Cien and more — with prices in EUR. Browse this week's leaflet sales and next week's announced offers.",
};

const MAX_SCAN = 3000;

function startOfWeek(offsetWeeks = 0): Date {
  const d = new Date();
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day + offsetWeeks * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

type Sp = Record<string, string | string[] | undefined>;

export default async function Deals({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const week = ["this", "next", "all"].includes(one(sp, "week") || "") ? one(sp, "week")! : "this";
  const q = one(sp, "q")?.trim();
  const brands = many(sp, "brand");
  const country = one(sp, "country");
  const price = parsePriceOp(one(sp, "price"));
  const offer = one(sp, "offer") ?? "unknown";
  const online = one(sp, "online") ?? "unknown";
  const sortcol = ["price", "date", "discount"].includes(one(sp, "sortcol") || "") ? one(sp, "sortcol")! : "date";
  const sortdir = (one(sp, "sortdir") || "desc") === "asc" ? "asc" : "desc";
  const view = one(sp, "view") === "table" ? "table" : "cards";
  const ps = one(sp, "ps") ?? "24";
  const pageSize = ps === "all" ? MAX_SCAN : Math.max(10, Math.min(200, Number(ps) || 24));
  const page = Math.max(1, Number(one(sp, "page") || 1));

  const brandSlugs = brands.length ? BRANDS.filter((b) => brands.includes(b.family)).map((b) => b.slug) : undefined;
  const thisWeekStart = startOfWeek(0);
  const nextWeekStart = startOfWeek(1);
  const nextWeekEnd = startOfWeek(2);

  const fx = await getFxRates();

  type Deal = {
    erpNumber: string | null;
    title: string;
    brand: string;
    imageUrl: string | null;
    url: string | null;
    countryCode: string;
    price: number | null;
    local: string | null;
    eurWas: number | null;
    discount: number | null;
    promo: string | null;
    online: boolean | null;
    date: Date;
    valid?: string | null;
    key?: string;
    imageSrcs?: string[];
  };

  let deals: Deal[] = [];

  if (week === "next") {
    const leaflets = await prisma.leaflet.findMany({
      where: { validFrom: { gte: nextWeekStart, lt: nextWeekEnd } },
      include: { offers: true },
      orderBy: { validFrom: "asc" },
    });
    let all = leaflets.flatMap((lf) =>
      lf.offers.map((o) => {
        const eur = o.price != null ? (fx && o.currency && o.currency !== "EUR" ? convert(o.price, o.currency, "EUR", fx) : o.price) : null;
        return {
          key: o.offerKey,
          erpNumber: o.erpNumber,
          title: o.title,
          brand: o.brand || "",
          imageUrl: o.imageUrl,
          imageSrcs: o.imageUrl ? [`/api/img?u=${encodeURIComponent(o.imageUrl)}`] : undefined,
          url: o.url ?? (lf.viewUrl ?? null),
          countryCode: lf.countryCode,
          price: eur,
          local: o.price != null && o.currency && o.currency !== "EUR" ? fmtLocal(o.price, o.currency) : null,
          eurWas: null,
          discount: null,
          promo: null,
          online: null,
          date: lf.validFrom ?? lf.fetchedAt,
          valid: [lf.validFrom, lf.validUntil].every(Boolean)
            ? `${fmtDate(lf.validFrom!)} – ${fmtDate(lf.validUntil!)}`
            : null,
        };
      }),
    );
    // own-brands only: keep offers whose ERP is a tracked product or whose
    // brand name matches a tracked brand (filters out other-brand and grocery
    // items that Lidl mixes into its flyers)
    const offerErps = [...new Set(all.map((o) => o.erpNumber).filter(Boolean))] as string[];
    const known = new Set(
      offerErps.length
        ? (await prisma.product.findMany({ where: { erpNumber: { in: offerErps } }, select: { erpNumber: true } })).map((p) => p.erpNumber)
        : [],
    );
    let filtered = all.filter((o) => (o.erpNumber ? known.has(o.erpNumber) : BRANDS.some((b) => b.queries.some((qr) => o.brand.toUpperCase().includes(qr.toUpperCase())))));
    if (brandSlugs) filtered = filtered.filter((o) => o.erpNumber || brandMatch(o.brand, brandSlugs));
    all = filterOffers(filtered, q, price, country);
    deals = all;
  } else {
    const all = await prisma.listing.findMany({
        where: {
          currentPrice: { not: null },
          OR: [{ promo: { not: null } }, { oldPrice: { not: null } }],
          ...(country ? { countryCode: country } : {}),
          ...(brandSlugs ? { product: { brandSlug: { in: brandSlugs } } } : {}),
          ...(week === "this" ? { priceUpdatedAt: { gte: thisWeekStart } } : {}),
        },
        include: { product: true },
      orderBy: { priceUpdatedAt: "desc" },
      take: MAX_SCAN,
    });
    deals = all
      .map((l) => {
        const eur = fx && l.currency ? convert(l.currentPrice!, l.currency, "EUR", fx) : l.currentPrice;
        const eurWas = l.oldPrice != null && fx && l.currency ? convert(l.oldPrice, l.currency, "EUR", fx) : l.oldPrice;
        return {
          erpNumber: l.erpNumber,
          title: l.product.titleEn || l.product.title,
          brand: l.product.brandName || l.product.brandSlug || "",
          imageUrl: l.product.imageUrl,
          imageSrcs: productImageSrcs(l.product),
          url: l.url,
          countryCode: l.countryCode,
          price: eur,
          local: l.currency && l.currency !== "EUR" ? fmtLocal(l.currentPrice!, l.currency) : null,
          eurWas: eurWas ?? null,
          discount: eur != null && eurWas != null && eurWas > 0 ? Math.round(((eurWas - eur) / eurWas) * 100) : null,
          promo: l.promo,
          online: l.online,
          date: l.priceUpdatedAt ?? l.product.lastSeen,
        } as Deal;
      })
      .filter((d) =>
        offer === "yes" ? d.promo != null || d.eurWas != null : offer === "no" ? d.promo == null && d.eurWas == null : true,
      )
      .filter((d) => (online === "yes" ? d.online === true : online === "no" ? d.online === false : true))
      .filter((d) => (q ? `(erp:${d.erpNumber}) ${d.title} ${d.brand}`.toLowerCase().includes(q.toLowerCase()) : true));
    if (price?.min != null) deals = deals.filter((d) => d.price != null && d.price >= price.min!);
    if (price?.max != null) deals = deals.filter((d) => d.price != null && d.price <= price.max!);

    // --- merge in leaflet offers -------------------------------------------
    // The storefront promos above only cover products sold in the online shop.
    // The weekly leaflets carry the full in-store sale — merge their offers
    // (own-brands only) so This Week / All current show everything.
    const now = new Date();
    const weekEnd = new Date(thisWeekStart.getTime() + 7 * 86400000);
    const leaflets = await prisma.leaflet.findMany({
      where:
        week === "this"
          ? { validFrom: { lt: weekEnd }, OR: [{ validUntil: { gte: thisWeekStart } }, { validUntil: null }] }
          : { OR: [{ validUntil: { gte: now } }, { validUntil: null }] },
      include: { offers: true },
      orderBy: { validFrom: "asc" },
    });
    // resolve offer ERPs to catalog products so we can apply the own-brand filter
    const offerErps = [...new Set(leaflets.flatMap((lf) => lf.offers.map((o) => o.erpNumber).filter(Boolean)))].map(String);
    const offerProducts = offerErps.length
      ? await prisma.product.findMany({
          where: { erpNumber: { in: offerErps } },
          select: { erpNumber: true, brandSlug: true, brandName: true, title: true, titleEn: true, imageUrl: true, images: true, storedImages: true },
        })
      : [];
    const productByErp = new Map(offerProducts.map((p) => [p.erpNumber, p]));
    const ownBrandOk = (o: (typeof leaflets)[number]["offers"][number]) => {
      if (o.erpNumber) return productByErp.has(o.erpNumber); // catalog = own-brands only
      return BRANDS.some((b) =>
        b.queries.some((qr) => (o.brand || "").toUpperCase().includes(qr.toUpperCase())),
      );
    };
    // a leaflet offer that duplicates a storefront promo (same ERP + country) is dropped
    const storeKeys = new Set(deals.filter((d) => d.erpNumber).map((d) => `${d.erpNumber}:${d.countryCode}`));
    const leafletDeals: Deal[] = leaflets.flatMap((lf) =>
      lf.offers
        .filter((o) => o.erpNumber ? !storeKeys.has(`${o.erpNumber}:${lf.countryCode}`) : true)
        .filter(ownBrandOk)
        .map((o) => {
          const eur = o.price != null ? (fx && o.currency && o.currency !== "EUR" ? convert(o.price, o.currency, "EUR", fx) : o.price) : null;
          const p = o.erpNumber ? productByErp.get(o.erpNumber) : undefined;
          return {
            key: o.offerKey,
            erpNumber: o.erpNumber,
            title: o.title,
            brand: o.brand || p?.brandName || p?.brandSlug || "",
            imageUrl: o.imageUrl ?? p?.imageUrl ?? null,
            imageSrcs: p ? productImageSrcs(p) : o.imageUrl ? [`/api/img?u=${encodeURIComponent(o.imageUrl)}`] : undefined,
            url: o.url ?? (lf.viewUrl ?? null),
            countryCode: lf.countryCode,
            price: eur,
            local: o.price != null && o.currency && o.currency !== "EUR" ? fmtLocal(o.price, o.currency) : null,
            eurWas: null,
            discount: null,
            promo: lf.name,
            online: null,
            date: lf.validFrom ?? lf.fetchedAt,
            valid: [lf.validFrom, lf.validUntil].every(Boolean)
              ? `${fmtDate(lf.validFrom!)} – ${fmtDate(lf.validUntil!)}`
              : null,
          } as Deal;
        }),
    );
    deals = [...deals, ...leafletDeals]
      .filter((d) => (offer === "yes" ? d.promo != null || d.eurWas != null : offer === "no" ? d.promo == null && d.eurWas == null : true))
      .filter((d) => (online === "yes" ? d.online === true : online === "no" ? d.online === false : true))
      .filter((d) => (q ? `(erp:${d.erpNumber}) ${d.title} ${d.brand}`.toLowerCase().includes(q.toLowerCase()) : true));
    if (price?.min != null) deals = deals.filter((d) => d.price != null && d.price >= price.min!);
    if (price?.max != null) deals = deals.filter((d) => d.price != null && d.price <= price.max!);
  }

  const sorted = deals.slice().sort((a, b) => {
    if (sortcol === "price") return sortdir === "asc" ? (a.price ?? Infinity) - (b.price ?? Infinity) : (b.price ?? -1) - (a.price ?? -1);
    if (sortcol === "discount") {
      if (a.discount != null && b.discount != null) return sortdir === "asc" ? a.discount - b.discount : b.discount - a.discount;
      if (a.discount != null) return -1;
      if (b.discount != null) return 1;
      return 0;
    }
    return sortdir === "asc" ? a.date.getTime() - b.date.getTime() : b.date.getTime() - a.date.getTime();
  });

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);

  const activeFilters = (q ? 1 : 0) + brands.length + (country ? 1 : 0) + (price ? 1 : 0) + (week !== "next" && offer !== "unknown" ? 1 : 0) + (week !== "next" && online !== "unknown" ? 1 : 0);

  const qs = (o: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
    return `/deals?${p.toString()}`;
  };
  const stateParams = () => ({
    week,
    q,
    brand: brands.join(","),
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
      <h1 style={{ margin: "24px 0 4px" }}>Sales</h1>
      <p style={{ color: "var(--muted)" }}>
        {week === "next"
          ? `${total} announced offers from next week's leaflets (${fmtDate(nextWeekStart)} onwards).`
          : `${total} current in-store deals${week === "this" ? " — this week's leaflets and price drops" : ""}.`}
      </p>

      <div className="pp-bar">
        <div className="week-toggle">
          <Link className={`pp-btn week-btn ${week === "this" ? "active" : ""}`} href={qs({ week: "this" })}>
            This Week
          </Link>
          <Link className={`pp-btn week-btn ${week === "next" ? "active" : ""}`} href={qs({ week: "next" })}>
            Next Week
          </Link>
          <Link className={`pp-btn week-btn ${week === "all" ? "active" : ""}`} href={qs({ week: "all" })}>
            All current
          </Link>
        </div>
        <Suspense fallback={null}>
          <FilterButton active={activeFilters} hidden={{ week }} resetParams={["sortcol", "sortdir", "view", "ps", "week"]}>
            <label className="field">
              <span>Product (code, brand or name)</span>
              <input type="text" name="q" defaultValue={q || ""} placeholder="e.g. 100414316 or parkside screwdriver" />
            </label>
            <label className="field">
              <span>Brand (multiple)</span>
              <select name="brand" multiple defaultValue={brands} size={5}>
                {[...new Map(BRANDS.map((b) => [b.family, b])).keys()].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Price (EUR) — use &lt; or &gt; operators (e.g. &lt;100 or &gt;50)</span>
              <input type="text" name="price" defaultValue={one(sp, "price") || ""} />
            </label>
            {week !== "next" ? (
              <>
                <label className="field">
                  <span>Offer</span>
                  <select name="offer" defaultValue={offer}>
                    <option value="unknown">Unknown</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
                <label className="field">
                  <span>Online</span>
                  <select name="online" defaultValue={online}>
                    <option value="unknown">Unknown</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
              </>
            ) : null}
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
          </FilterButton>
          <SortButton hidden={{ week, q, brand: brands.join(","), country }}
            columns={
              week === "next"
                ? [
                    { value: "price", label: "Price (EUR)" },
                    { value: "date", label: "Valid from" },
                  ]
                : [
                    { value: "discount", label: "Discount %" },
                    { value: "price", label: "Price (EUR)" },
                    { value: "date", label: "Date" },
                  ]
            }
          />
          {week !== "next" ? <ViewToggle view={view as "table" | "cards"} /> : null}
          <ParamSelect
            name="ps"
            value={ps}
            options={["24", "50", "100", "200", "all"].map((v) => ({ value: v, label: v === "all" ? "All" : v }))}
          />
        </Suspense>
      </div>

      {total === 0 ? (
        <div className="empty">
          {week === "this" ? (
            <>
              No deals captured since {thisWeekStart} — the crawler updates during the week.{" "}
              <Link href={qs({ week: "all" })}>Show all current deals</Link>.
            </>
          ) : (
            "No offers found — run the leaflet step of the crawler, then re-check."
          )}
        </div>
      ) : week !== "next" && view === "cards" ? (
        <div className="grid">
          {pageRows.map((d) => (
            <div key={`${d.countryCode}-${d.erpNumber}`}>
              {d.discount ? <span className="discount-badge">-{d.discount}%</span> : null}
              <ProductCard
                product={{ erpNumber: d.erpNumber!, title: d.title, imageUrl: d.imageUrl, brandName: d.brand, imageSrcs: d.imageSrcs }}
                listing={{
                  countryCode: d.countryCode,
                  currentPrice: d.price,
                  oldPrice: d.eurWas,
                  stockOk: true,
                  promo: d.promo,
                }}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="table-scroll">
          <table className="prices pp-table">
            <thead>
              <tr>
                <th>Image</th>
                {week === "next" ? null : <th>Code</th>}
                <th>Name</th>
                <th>Brand</th>
                <th>Price (EUR)</th>
                <th>Local</th>
                {week === "next" ? <th>Valid</th> : null}
                {week === "next" ? null : <th>Was (EUR)</th>}
                <th>Country</th>
                {week === "next" ? null : <th>Promo</th>}
                <th>{week === "next" ? "From" : "Updated"}</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((d) => (
                <tr key={d.key ?? `${d.countryCode}-${d.erpNumber}`}>
                  <td>
                    {d.imageUrl ? <img src={d.imageSrcs?.[0] ?? d.imageUrl} alt="" loading="lazy" style={{ width: 44, height: 44, objectFit: "contain" }} /> : null}
                  </td>
                  {week === "next" ? null : (
                    <td className="pp-code">
                      <Link href={`/products/${d.erpNumber}`}>{d.erpNumber}</Link>
                    </td>
                  )}
                  <td className="pp-name">{d.url ? <a href={d.url} target="_blank" rel="noreferrer">{d.title}</a> : d.title}</td>
                  <td>{d.brand}</td>
                  <td className="cell-eur">{d.price != null ? fmtEur(d.price) : "—"}</td>
                  <td className="cell-local">{d.local ?? ""}</td>
                  {week === "next" ? <td>{d.valid ?? ""}</td> : null}
                  {week === "next" ? null : (
                    <td style={{ color: "var(--muted)", textDecoration: "line-through" }}>
                      {d.eurWas != null ? fmtEur(d.eurWas) : ""}
                    </td>
                  )}
                  <td>{d.countryCode}</td>
                  {week === "next" ? null : <td className="pp-promo">{d.promo || ""}</td>}
                  <td>{fmtDate(d.date)}</td>
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
        <PageNumbers page={page} totalPages={totalPages} href={(n) => qs({ ...stateParams(), page: n })} />
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

function brandMatch(brand: string, slugs: string[]): boolean {
  const b = brand.toLowerCase();
  return slugs.some((s) => b.includes(s.replace(/-/g, " ")));
}

function filterOffers<T extends { title: string; brand: string; countryCode: string; price: number | null; erpNumber: string | null }>(
  arr: T[],
  q: string | undefined,
  price: { min?: number; max?: number } | undefined,
  country: string | undefined,
): T[] {
  let out = arr;
  if (q) {
    const needle = q.toLowerCase();
    out = out.filter((o) => `(erp:${o.erpNumber}) ${o.title} ${o.brand} ${o.countryCode}`.toLowerCase().includes(needle));
  }
  if (price?.min != null) out = out.filter((o) => o.price != null && o.price >= price.min!);
  if (price?.max != null) out = out.filter((o) => o.price != null && o.price <= price.max!);
  if (country) out = out.filter((o) => o.countryCode === country);
  return out;
}
