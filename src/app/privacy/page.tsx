import Link from "next/link";

export const metadata = { title: "Privacy — Lidlr" };

export default function PrivacyPage() {
  const contact = process.env.ALERT_FROM_EMAIL || "the operator's contact address (set ALERT_FROM_EMAIL on this server)";
  return (
    <div style={{ maxWidth: 760, marginBottom: 40 }}>
      <h1 style={{ margin: "24px 0 8px" }}>Privacy policy</h1>
      <p style={{ color: "var(--muted)" }}>Last updated: 2025 — Lidlr (this site), an independent Lidl price tracker, not affiliated with Lidl.</p>

      <h2 className="section">What we collect</h2>
      <ul style={{ lineHeight: 1.7 }}>
        <li><strong>Email address</strong> — only if you sign in to track products. Used to send you login codes and notifications you asked for. No password is ever stored (there are none).</li>
        <li><strong>Tracked products</strong> — the product IDs you chose to track, linked to your account.</li>
        <li><strong>Notification settings</strong> — email on/off and, if you opt in, your WhatsApp number and your personal CallMeBot key so we can send you messages.</li>
        <li><strong>Price data</strong> — public product and price information crawled from Lidl&apos;s public online shops. This is not personal data.</li>
      </ul>

      <h2 className="section">What we never collect</h2>
      <p>
        No analytics, no advertising, no cross-site tracking, no device fingerprinting, no data sold or shared with
        advertisers. The only cookies used are the strictly necessary ones listed on the{" "}
        <Link href="/cookies">cookie page</Link>.
      </p>

      <h2 className="section">Third parties involved</h2>
      <ul style={{ lineHeight: 1.7 }}>
        <li><strong>Lidl online shops</strong> — public data source (product titles, prices, stock badges, images).</li>
        <li><strong>translate.googleapis.com (community endpoint)</strong> — product titles are translated automatically for readability; no personal data is sent.</li>
        <li><strong>frankfurter.dev</strong> — European Central Bank exchange rates to show approximate EUR equivalents; no personal data is sent.</li>
        <li><strong>Resend</strong> — email delivery of your login code and notifications (only your email address is passed).</li>
        <li><strong>CallMeBot</strong> — WhatsApp delivery of notifications, only when you opt in (your number and message text are passed).</li>
        <li><strong>Hosting</strong> — where you deploy Lidlr (self-hosted) determines server logs; Lidlr itself adds no extra logging of visitors.</li>
      </ul>

      <h2 className="section">Legal basis &amp; retention</h2>
      <p>
        Processing of your email and notification preferences is based on your consent and performance of the
        tracking service you request (GDPR art. 6(1)(a)/(b)). One-time login codes are stored only as a hash and
        expire after 15 minutes. Your account data is kept until you delete it.
      </p>

      <h2 className="section">Your rights</h2>
      <p>
        You can exercise access, export and erasure yourself: the <Link href="/alerts">Tracking page</Link> has a
        &ldquo;Delete account &amp; all my data&rdquo; button that removes your account, tracked products, and
        notifications immediately. For anything else, contact {contact}.
      </p>
    </div>
  );
}
