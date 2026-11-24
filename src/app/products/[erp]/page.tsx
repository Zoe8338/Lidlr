import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { COUNTRIES } from "@/lib/lidl/catalog";
import { PriceChart } from "@/components/PriceChart";
import { AlertForm } from "@/components/AlertForm";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ erp: string }> }) {
  const { erp } = await params;
  const product = await prisma.product.findUnique({
    where: { erpNumber: erp },
    include: { listings: { include: { country: true }, orderBy: { countryCode: "asc" } } },
  });
  if (!product) notFound();

  const snapshots = await prisma.snapshot.findMany({
    where: { erpNumber: erp, price: { not: null } },
    orderBy: { takenAt: "asc" },
    take: 500,
  });

  const priced = product.listings.filter((l) => l.currentPrice != null);
  const best = priced.sort((a, b) => a.currentPrice! - b.currentPrice!)[0];
  const historyByCountry = new Map<string, { t: Date; price: number }[]>();
  for (const s of snapshots) {
    const list = historyByCountry.get(s.countryCode) ?? [];
    list.push({ t: s.takenAt, price: s.price! });
    historyByCountry.set(s.countryCode, list);
  }
  const chartPoints = (historyByCountry.get(best?.countryCode ?? "") ?? snapshots.map((s) => ({ t: s.takenAt, price: s.price! })));

  return (
    <div style={{ padding: "24px 0" }}>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <img
          src={product.imageUrl || ""}
          alt={product.title}
          style={{ width: 280, height: 280, objectFit: "contain", background: "#fff", borderRadius: 10, border: "1px solid var(--border)" }}
        />
        <div style={{ flex: 1, minWidth: 280 }}>
          <h1 style={{ margin: "0 0 6px", fontSize: 24 }}>{product.title}</h1>
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            {product.brandName} · ERP {product.erpNumber} · first seen {new Date(product.firstSeen).toLocaleDateString()}
          </p>
          <div style={{ margin: "10px 0" }}>
            <Link className="button ghost" href={`/alerts?erp=${erp}`}>
              Create alert for this product
            </Link>
          </div>
        </div>
      </div>

      <h2 className="section">Prices by country</h2>
      <table className="prices">
        <thead>
          <tr>
            <th>Country</th>
            <th>Price</th>
            <th>Was</th>
            <th>Stock</th>
            <th>Promo</th>
            <th>Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {product.listings.length === 0 ? (
            <tr>
              <td colSpan={7} className="empty">
                No listings captured in the last crawl.
              </td>
            </tr>
          ) : (
            product.listings.map((l) => (
              <tr key={l.id} className={best && l.id === best.id ? "best" : ""}>
                <td>{l.country?.name ?? l.countryCode}</td>
                <td>{l.currentPrice != null ? `${l.currentPrice.toFixed(2)} ${l.currency ?? ""}` : "—"}</td>
                <td>{l.oldPrice ? l.oldPrice.toFixed(2) : ""}</td>
                <td>{l.stockOk ? (l.stockText ?? "in stock") : l.stockText || "out of stock"}</td>
                <td>{l.promo || ""}</td>
                <td>{l.priceUpdatedAt ? new Date(l.priceUpdatedAt).toLocaleDateString() : ""}</td>
                <td>
                  {l.url ? (
                    <a href={l.url} target="_blank" rel="noreferrer">
                      {l.countryCode} shop ↗
                    </a>
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <h2 className="section">Price history {best ? `— ${best.countryCode}` : ""}</h2>
      <PriceChart points={chartPoints.slice(-60)} />
      {historyByCountry.size > 1 ? (
        <div className="toolbar" style={{ marginTop: 12 }}>
          {[...historyByCountry.keys()].map((cc) => (
            <span key={cc} className="badge">
              {cc}: {historyByCountry.get(cc)!.length} snapshots
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
