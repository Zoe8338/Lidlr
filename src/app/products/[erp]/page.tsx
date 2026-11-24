import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { COUNTRIES } from "@/lib/lidl/catalog";
import { PriceChart } from "@/components/PriceChart";
import { Gallery } from "@/components/Gallery";
import { TrackDialog } from "@/components/TrackDialog";
import { convert, getFxRates } from "@/lib/fx";
import { emailConfigured } from "@/lib/mail";

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
  const palette = ["#0e62c4", "#d97706", "#178a3e", "#8b5cf6", "#d43f3f", "#0891b2"];
  const chartSeries = [...historyByCountry.entries()]
    .filter(([, pts]) => pts.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, palette.length)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cc, pts], i) => ({ cc, color: palette[i % palette.length], points: pts.slice(-120) }));
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
            <TrackDialog
              erp={erp}
              productTitle={product.title}
              countries={COUNTRIES.filter((c) => c.enabled).map((c) => ({ code: c.code, name: c.name }))}
              signedIn={!!user}
              whatsappReady={!!user?.notifyWhatsapp &&
                !!user?.whatsappPhone &&
                !!user?.whatsappKey}
              emailReady={emailConfigured()}
              existing={
                tracked
                  ? {
                      countryCode: tracked.countryCode,
                      maxPrice: tracked.maxPrice,
                      offerOnly: tracked.offerOnly,
                      onlineOnly: tracked.onlineOnly,
                      notifyEmail: tracked.notifyEmail,
                      notifyWhatsapp: tracked.notifyWhatsapp,
                    }
                  : null
              }
            />
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

      <h2 className="section">Price history by country</h2>
      <PriceChart series={chartSeries} />
    </div>
  );
}
