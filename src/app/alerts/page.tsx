import Link from "next/link";
import { prisma } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { emailConfigured } from "@/lib/mail";
import { toggleTrack, saveNotifSettings, deleteAccount } from "@/app/actions";
import { ProductCard } from "@/components/ProductCard";

export const dynamic = "force-dynamic";

export default async function TrackingPage() {
  const user = await currentUser();

  if (!user) {
    return (
      <div>
        <h1 style={{ margin: "24px 0 8px" }}>Tracking</h1>
        <p className="notice">
          Tracking is ParkPrice-style: track any product with one click and get notified by email or WhatsApp when
          its price drops, it comes back in stock, or it goes on sale. <Link href="/login">Sign in with your
          email</Link> — we send you a one-time code, no password is ever stored.
        </p>
      </div>
    );
  }

  const tracked = await prisma.tracking.findMany({
    where: { userId: user.id },
    include: { product: { include: { listings: true } } },
    orderBy: { createdAt: "desc" },
    take: 120,
  });

  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 60,
  });

  const whatsappReady = !!user.whatsappPhone && !!user.whatsappKey;

  return (
    <div>
      <h1 style={{ margin: "24px 0 4px" }}>My tracking</h1>
      <p className="notice">
        You get a {emailConfigured() ? "email" : "notification"} whenever a tracked product{" "}
        <strong>drops in price</strong>, <strong>comes back in stock</strong>, or <strong>goes on sale</strong>{" "}
        in any crawled country. Track more products from any{" "}
        <Link href="/products">product page</Link>.
      </p>

      <h2 className="section">Tracked products ({tracked.length})</h2>
      {tracked.length === 0 ? (
        <div className="empty">
          Nothing tracked yet — open any <Link href="/products">product</Link> and hit &ldquo;Track this
          product&rdquo;.
        </div>
      ) : (
        <div className="grid">
          {tracked.map((t) => {
            const p = t.product;
            const l = p.listings.find((x) => x.currentPrice != null) ?? p.listings[0];
            return (
              <div key={t.id} style={{ position: "relative" }}>
                <ProductCard product={p} listing={l} />
                <form action={toggleTrack} style={{ position: "absolute", top: 8, right: 8 }}>
                  <input type="hidden" name="erp" value={t.erpNumber} />
                  <button className="button danger" type="submit" title="Stop tracking">
                    ✕
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      )}

      <h2 className="section">Notifications</h2>
      {notifications.length === 0 ? (
        <div className="empty">No notifications yet — this feed fills as crawls spot changes on tracked products.</div>
      ) : (
        <table className="prices">
          <thead>
            <tr>
              <th>When</th>
              <th>What</th>
              <th>Delivery</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {notifications.map((n) => (
              <tr key={n.id}>
                <td>{new Date(n.createdAt).toLocaleString()}</td>
                <td>
                  {n.message}
                </td>
                <td className={`badge ${n.emailed || n.whatsapp ? "" : "out"}`}>
                  {n.emailed && n.whatsapp ? "sent" : n.emailed ? "emailed" : n.whatsapp ? "whatsapp" : "pending"}
                </td>
                <td>
                  {n.erpNumber ? (
                    <Link href={`/products/${n.erpNumber}`}>view ↗</Link>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="section">Notification settings</h2>
      <div className="card" style={{ maxWidth: 560 }}>
        <form action={saveNotifSettings} className="inline" style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" name="notifyEmail" defaultChecked={user.notifyEmail} />
            <span>Email me notifications ({user.email})</span>
          </label>

          <div>
            <strong>WhatsApp</strong> (free via{" "}
            <a href="https://www.callmebot.com/blog/free-api-for-whatsapp-messages/" target="_blank" rel="noreferrer">
              CallMeBot
            </a>
            ) — message their bot once to get your personal key, then paste it here.
          </div>
          <label>
            <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 4 }}>
              WhatsApp number (with country code, e.g. +351912345678)
            </div>
            <input name="whatsappPhone" defaultValue={user.whatsappPhone ?? ""} placeholder="+351912345678" />
          </label>
          <label>
            <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 4 }}>
              CallMeBot API key
            </div>
            <input
              name="whatsappKey"
              type="password"
              defaultValue=""
              placeholder={user.whatsappKey ? "••••• (saved — leave empty to keep)" : "paste your key"}
            />
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              name="notifyWhatsapp"
              defaultChecked={user.notifyWhatsapp}
              disabled={!whatsappReady}
            />
            <span>Send notifications to WhatsApp{whatsappReady ? "" : " (add number + key first)"}</span>
          </label>

          <div>
            <button type="submit">Save settings</button>
          </div>
          <div style={{ color: "var(--muted)", fontSize: 12.5 }}>
            Email is delivered via Resend and WhatsApp via CallMeBot. The WhatsApp key is stored only to send your
            own notifications.
          </div>
        </form>
      </div>

      <h2 className="section">Account</h2>
      <div className="card" style={{ maxWidth: 560 }}>
        <div style={{ marginBottom: 12 }}>
          Signed in as <strong>{user.email}</strong> — since {new Date(user.createdAt).toLocaleDateString()}.
        </div>
        <form action={deleteAccount}>
          <button className="button danger" type="submit">
            Delete account &amp; all my data
          </button>
        </form>
      </div>
    </div>
  );
}
