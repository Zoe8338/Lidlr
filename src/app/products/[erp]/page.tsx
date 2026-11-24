import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { COUNTRIES } from "@/lib/lidl/catalog";
import { PriceChart } from "@/components/PriceChart";
import { AlertForm } from "@/components/AlertForm";
import { Gallery } from "@/components/Gallery";
import { toggleTrack } from "@/app/actions";
import { convert, getFxRates } from "@/lib/fx";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ erp: string }> }) {
  const { erp } = await params;
  const user = await currentUser();
  const product = await prisma.product.findUnique({
    where: { erpNumber: erp },
    include: { listings: { include: { country: true }, orderBy: { countryCode: "asc" } } },
  });
  if (!product) notFound();
  const productImages = (() => {
    try { return product.images ? (JSON.parse(product.images) as string[]) : []; }
    catch { return []; }
  })();
  const galleryImages = [
    product.imageUrl,
    ...productImages,
  ].filter((x, i, a): x is string => !!x && a.indexOf(x) === i).slice(0, 4);

  const snapshots = await prisma.snapshot.findMany({
    where: { erpNumber: erp, price: { not: null } },
    orderBy: { takenAt: "asc" },
    take: 500,
  });

  const priced = product.listings.filter((l) => l.currentPrice != null);
  const best = priced.sort((a, b) => a.currentPrice! - b.currentPrice!)[0];
  const tracked = user
    ? await prisma.tracking.findUnique({
        where: { userId_erpNumber: { userId: user.id, erpNumber: erp } },
      })
    : null;
  const historyByCountry = new Map<string, { t: Date; price: number }[]>();
  for (const s of snapshots) {
    const list = historyByCountry.get(s.countryCode) ?? [];
    list.push({ t: s.takenAt, price: s.price! });
    historyByCountry.set(s.countryCode, list);
  }
  const chartPoints = (historyByCountry.get(best?.countryCode ?? "") ?? snapshots.map((s) => ({ t: s.takenAt, price: s.price! })));
  const fx = await getFxRates();

  return (
    <div style={{ padding: "24px 0" }}>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <Gallery images={galleryImages} title={product.title} />
        <div style={{ flex: 1, minWidth: 280 }}>
          <h1 style={{ margin: "0 0 6px", fontSize: 24 }}>{product.title}</h1>
          {product.titleEn && product.titleEn !== product.title ? (
            <p style={{ color: "var(--accent)", marginTop: 0, fontWeight: 600 }}>{product.titleEn}</p>
          ) : null}
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            {product.brandName} · ERP {product.erpNumber} · first seen {new Date(product.firstSeen).toLocaleDateString()}
          </p>
          <div style={{ margin: "10px 0", display: "flex", gap: 10, flexWrap: "wrap" }}>
            {user ? (
              <form action={toggleTrack}>
                <input type="hidden" name="erp" value={erp} />
                <button className={tracked ? "button danger" : "button"} type="submit">
                  {tracked ? "✓ Tracked — stop tracking" : "Track this product"}
                </button>
              </form>
            ) : (
              <Link className="button" href="/login">
                Track this product
              </Link>
            )}
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
            {fx ? <th>≈ EUR</th> : null}
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
              <td colSpan={8} className="empty">
                No listings captured in the last crawl.
              </td>
            </tr>
          ) : (
            product.listings.map((l) => (
              <tr key={l.id} className={best && l.id === best.id ? "best" : ""}>
                <td>{l.country?.name ?? l.countryCode}</td>
                <td>{l.currentPrice != null ? `${l.currentPrice.toFixed(2)} ${l.currency ?? ""}` : "—"}</td>
                {fx ? (
                  <td>
                    {l.currentPrice != null && l.currency
                      ? (() => {
                          const eur = convert(l.currentPrice, l.currency, "EUR", fx);
                          return eur != null ? eur.toFixed(2) : "—";
                        })()
                      : ""}
                  </td>
                ) : null}
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
