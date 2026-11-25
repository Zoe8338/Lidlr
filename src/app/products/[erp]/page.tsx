import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { COUNTRIES } from "@/lib/lidl/catalog";
import { PriceChart } from "@/components/PriceChart";
import { Gallery } from "@/components/Gallery";
import { TrackDialog } from "@/components/TrackDialog";
import { convert, fmtEur, fmtLocal, getFxRates } from "@/lib/fx";
import { emailConfigured } from "@/lib/mail";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ erp: string }> }): Promise<Metadata> {
  const { erp } = await params;
  const product = await prisma.product.findUnique({ where: { erpNumber: erp } });
  if (!product) return { title: "Product not found — Lidlr" };
  const title = product.titleEn || product.title;
  return {
    title: `${title} — price across EU Lidl shops — Lidlr`,
    description: `Track ${product.brandName ?? "Lidl own-brand"} ${title} (ERP ${erp}): current prices per EU country in EUR, price history, weekly in-store deals, manuals and availability alerts.`,
    alternates: { canonical: `/products/${erp}` },
    openGraph: {
      title: `${title} — Lidl price tracker`,
      description: "Prices per-country in EUR, price history charts and restock/deal alerts.",
      images: product.imageUrl ? [product.imageUrl] : undefined,
    },
  };
}

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
  const manuals = await prisma.manual.findMany({
    where: { erpNumber: erp },
    orderBy: { id: "asc" },
  });
  const fx = await getFxRates();

  return (
    <div style={{ padding: "24px 0" }}>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <Gallery images={galleryImages} title={product.title} />
        <div style={{ flex: 1, minWidth: 280 }}>
          <h1 style={{ margin: "0 0 6px", fontSize: 24 }}>{product.titleEn || product.title}</h1>
          {product.titleEn && product.titleEn !== product.title ? (
            <p style={{ color: "var(--accent)", marginTop: 0, fontWeight: 600 }}>{product.titleEn}</p>
          ) : null}
          <p style={{ color: "var(--muted)", marginTop: 0 }}>
            {product.brandName} · ERP {product.erpNumber} · first seen {new Date(product.firstSeen).toLocaleDateString()}
          </p>
          {best && best.currentPrice != null ? (
            <p className="best-strip">
              {(() => {
                if (best.currentPrice == null) return null;
                const eur = best.currency && fx ? convert(best.currentPrice, best.currency, "EUR", fx) : best.currentPrice;
                const was = best.oldPrice != null && best.currency && fx ? convert(best.oldPrice, best.currency, "EUR", fx) : best.oldPrice;
                return (
                  <>
                    <strong>{eur != null ? fmtEur(eur) : "—"}</strong> best price across {priced.length} countr{priced.length === 1 ? "y" : "ies"} ({best.countryCode})
                    {was != null && was > (eur ?? 0) ? <span style={{ color: "var(--red)" }}> · down from {fmtEur(was)}</span> : null}
                  </>
                );
              })()}
            </p>
          ) : null}
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
      <div className="table-scroll">
        <table className="prices">
          <thead>
            <tr>
              <th>Country</th>
              <th>Price (EUR)</th>
              <th>Local price</th>
              <th>Was (EUR)</th>
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
                  <td className="cell-eur">
                    {l.currentPrice != null && l.currency && fx
                      ? (() => {
                          const eur = convert(l.currentPrice, l.currency, "EUR", fx);
                          return eur != null ? fmtEur(eur) : "—";
                        })()
                      : "—"}
                  </td>
                  <td className="cell-local">
                    {l.currentPrice != null && l.currency && l.currency !== "EUR" ? (
                      fmtLocal(l.currentPrice, l.currency)
                    ) : (
                      <span style={{ color: "var(--muted)" }}>same as EUR</span>
                    )}
                  </td>
                  <td>
                    {l.oldPrice != null && l.currency && fx
                      ? (() => {
                          const eur = convert(l.oldPrice, l.currency, "EUR", fx);
                          return eur != null ? fmtEur(eur) : l.oldPrice.toFixed(2);
                        })()
                      : ""}
                  </td>
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
      </div>

      <h2 className="section">Price history by country</h2>
      <PriceChart series={chartSeries} />

      {manuals.length ? (
        <>
          <h2 className="section">Manuals &amp; downloads</h2>
          <div className="table-scroll">
            <table className="prices manuals">
            <tbody>
              {manuals.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.title}
                    {m.language ? <span className="badge" style={{ marginLeft: 8 }}>{m.language}</span> : null}
                  </td>
                  <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                    {m.stored ? (
                      <a href={`/api/manuals/${m.id}`} target="_blank" rel="noreferrer">
                        Archived copy
                      </a>
                    ) : null}
                    {" "}
                    <a href={m.url} target="_blank" rel="noreferrer">
                      Official ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
          <p style={{ color: "var(--muted)", fontSize: 12 }}>
            &ldquo;Archived copy&rdquo; is stored on this server and stays up even if Lidl removes the original.
          </p>
        </>
      ) : null}
    </div>
  );
}
