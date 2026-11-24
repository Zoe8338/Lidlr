import { prisma } from "@/lib/db";
import { AlertForm, AlertRowActions } from "@/components/AlertForm";
import { BRANDS, COUNTRIES } from "@/lib/lidl/catalog";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  price_below: "price ≤",
  in_stock: "in stock",
  new_item: "new items",
  product: "product",
};

export default async function AlertsPage() {
  const [alerts, events] = await Promise.all([
    prisma.alert.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.alertEvent.findMany({ orderBy: { createdAt: "desc" }, take: 60 }),
  ]);

  const brandFamilies = [...new Set(BRANDS.map((b) => b.family))];
  const countryCodes = COUNTRIES.filter((c) => c.enabled).map((c) => c.code);

  return (
    <div>
      <h1 style={{ margin: "24px 0 6px" }}>Alerts</h1>
      <p className="notice">
        Alerts are evaluated after every crawl (weekly full crawl plus the daily alert check). If{" "}
        <code>RESEND_API_KEY</code> is configured, matches are emailed; otherwise they appear in the feed below. Not
        all Lidl APIs expose per-store shelf stock publicly, so &quot;in stock&quot; reflects the online shop&apos;s
        availability indicator for that country.
      </p>

      <h2 className="section">Create an alert</h2>
      <AlertForm brands={brandFamilies} countryCodes={countryCodes} />

      <h2 className="section">Your alerts</h2>
      {alerts.length === 0 ? (
        <div className="empty">No alerts yet.</div>
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
                <td>{a.email}</td>
                <td>
                  {KIND_LABEL[a.kind] || a.kind} {a.query ? `"${a.query}"` : ""} {a.brandSlug ? `· ${a.brandSlug}` : ""}{" "}
                  {a.maxPrice ? `· ≤ ${a.maxPrice}` : ""}
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
                <td style={{ color: "var(--yellow)" }}>{e.message}</td>
                <td className={`badge ${e.delivered ? "" : "out"}`}>{e.delivered ? "emailed" : "pending"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
