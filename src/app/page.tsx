import Link from "next/link";
import { prisma } from "@/lib/db";
import { BRANDS, COUNTRIES } from "@/lib/lidl/catalog";
import { ProductCard } from "@/components/ProductCard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [productCount, listingCount, lastRun, deals, fresh] = await Promise.all([
    prisma.product.count(),
    prisma.listing.count(),
    prisma.crawlRun.findFirst({ where: { finishedAt: null }, orderBy: { startedAt: "desc" } }),
    prisma.listing.findMany({
      where: { promo: { not: null }, currentPrice: { not: null }, stockOk: true },
      include: { product: true },
      orderBy: { priceUpdatedAt: "desc" },
      take: 8,
    }),
    prisma.product.findMany({ where: { removed: false }, orderBy: { firstSeen: "desc" }, take: 8, include: { listings: true } }),
  ]);

  const activeCountries = COUNTRIES.filter((c) => c.enabled).length;

  return (
    <div>
      <div className="hero">
        <h1>
          Lidl prices across Europe — <span style={{ color: "var(--yellow)" }}>tracked.</span>
        </h1>
        <p>
          Lidlr crawls Lidl&apos;s online shops every week for the brands you care about: Parkside &amp; Parkside
          Performance, Esmara &amp; Esmara Men, Crivit, Livery/Livergy, Cien, SilverCrest (Personal Care and Kitchen
          Tools), Dentalux and all things Livarno. Compare per-country prices, browse current promotions and new
          arrivals, and get alerts when something gets cheaper, comes back in stock, or appears in your country.
        </p>
      </div>

      <div className="statrow">
        <div className="stat">
          <div className="num">{productCount}</div>
          <div className="lbl">products tracked</div>
        </div>
        <div className="stat">
          <div className="num">{listingCount}</div>
          <div className="lbl">country listings</div>
        </div>
        <div className="stat">
          <div className="num">{activeCountries}</div>
          <div className="lbl">EU shops crawled</div>
        </div>
        <div className="stat">
          <div className="num">{BRANDS.length}</div>
          <div className="lbl">brands &amp; sub-brands</div>
        </div>
      </div>

      <h2 className="section">Brands</h2>
      <div className="grid">
        {[...new Map(BRANDS.map((b) => [b.family, b])).values()].map((b) => (
          <Link key={b.family} href={`/products?brand=${b.family}`} className="card">
            <div className="title" style={{ fontWeight: 700, textTransform: "capitalize" }}>
              {b.family}
            </div>
            <div className="meta">{BRANDS.filter((x) => x.family === b.family).length} sub-brands tracked</div>
          </Link>
        ))}
      </div>

      <h2 className="section">Latest deals</h2>
      {deals.length === 0 ? (
        <div className="empty">No deals captured yet — run the crawler.</div>
      ) : (
        <div className="grid">
          {deals.map((l) => (
            <ProductCard key={l.id} product={l.product} listing={l} />
          ))}
        </div>
      )}

      <h2 className="section">Newly discovered</h2>
      {fresh.length === 0 ? (
        <div className="empty">Nothing crawled yet — start with POST /api/crawl or <code>npm run crawl</code>.</div>
      ) : (
        <div className="grid">
          {fresh.map((p) => {
            const l = p.listings.find((x) => x.currentPrice != null) ?? p.listings[0];
            return <ProductCard key={p.erpNumber} product={p} listing={l} />;
          })}
        </div>
      )}

      <p className="notice" style={{ marginTop: 30 }}>
        {lastRun
          ? `Crawl in progress (${new Date(lastRun.startedAt).toLocaleString()}).`
          : "Alerts can target a price ceiling, stock status, or any new item for a brand — see Alerts."}
      </p>
    </div>
  );
}
