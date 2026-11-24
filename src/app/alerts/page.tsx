import Link from "next/link";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { AlertForm, AlertRowActions } from "@/components/AlertForm";
import { ProductCard } from "@/components/ProductCard";
import { BRANDS, COUNTRIES } from "@/lib/lidl/catalog";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  price_below: "price ≤",
  in_stock: "in stock",
  new_item: "new items",
  product: "product",
};

export default async function AlertsPage() {
  const user = await currentUser();

  const tracked = user
    ? await prisma.tracking.findMany({
        where: { userId: user.id },
        include: { product: { include: { listings: true } } },
        orderBy: { createdAt: "desc" },
        take: 60,
      })
    : [];

  const alerts = user
    ? await prisma.alert.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 })
    : await prisma.alert.findMany({ where: { userId: null }, orderBy: { createdAt: "desc" }, take: 100 });

  const alertIds = alerts.map((a) => a.id);
  const events = alertIds.length
    ? await prisma.alertEvent.findMany({ where: { alertId: { in: alertIds } }, orderBy: { createdAt: "desc" }, take: 60 })
    : [];

  const brandFamilies = [...new Set(BRANDS.map((b) => b.family))];
  const countryCodes = COUNTRIES.filter((c) => c.enabled).map((c) => c.code);

  return (
    <div>
      <h1 style={{ margin: "24px 0 4px" }}>{user ? "My tracking" : "Alerts"}</h1>

      {!user ? (
        <p className="notice">
          <Link href="/login">Sign in</Link> to track products with one click, keep all your alerts on your account,
          and see them on any device — no email typos, no lost alerts.
        </p>
      ) : null}

      {user ? (
        <>
          <h2 className="section">Tracked products</h2>
          {tracked.length === 0 ? (
            <div className="empty">
              Nothing tracked yet — open any <Link href="/products">product</Link> and hit “Track”.
            </div>
          ) : (
            <div className="grid">
              {tracked.map((t) => {
                const p = t.product;
                const l = p.listings.find((x) => x.currentPrice != null) ?? p.listings[0];
                return <ProductCard key={t.id} product={p} listing={l} />;
              })}
            </div>
          )}
        </>
      ) : null}

      <h2 className="section">Alert rules</h2>
      <div className="card" style={{ marginBottom: 16 }}>
        <AlertForm brands={brandFamilies} countryCodes={countryCodes} signedIn={!!user} />
      </div>
      {alerts.length === 0 ? (
        <div className="empty">No alert rules yet.</div>
      ) : (
        <table className="prices">
          <thead>
            <tr>
              <th>For</th>
              <th>Match</th>
              <th>Country</th>
              <th>Notify</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id}>
                <td>{a.userId ? "you" : a.email}</td>
                <td>
                  {KIND_LABEL[a.kind] || a.kind} {a.query && a.kind !== "product" ? `"${a.query}"` : ""}{" "}
                  {a.brandSlug ? `· ${a.brandSlug}` : ""} {a.maxPrice ? `· ≤ ${a.maxPrice}` : ""}
                </td>
                <td>{a.countryCode || "any"}</td>
                <td>{a.lastFiredAt ? new Date(a.lastFiredAt).toLocaleDateString() : "never"}</td>
                <td className={`badge ${a.active ? "" : "out"}`}>{a.active ? "active" : "paused"}</td>
                <td>
                  <AlertRowActions id={a.id} active={a.active} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="section">Recent matches</h2>
      {events.length === 0 ? (
        <div className="empty">Nothing matched yet.</div>
      ) : (
        <table className="prices">
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.createdAt).toLocaleString()}</td>
                <td>{e.title}</td>
                <td className="match">{e.message}</td>
                <td className={`badge ${e.delivered ? "" : "out"}`}>{e.delivered ? "emailed" : "pending"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
