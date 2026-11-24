import Link from "next/link";

export const metadata = { title: "Cookies — Lidlr" };

const COOKIES: { name: string; life: string; purpose: string }[] = [
  {
    name: "lidlr_session",
    life: "30 days",
    purpose:
      "Keeps you signed in after you verify a login code. HMAC-signed, httpOnly, only readable by this site. Deleted when you sign out.",
  },
  {
    name: "lidlr_theme",
    life: "1 year",
    purpose: "Remembers whether you picked the light or dark theme so pages don't flash the wrong one.",
  },
  {
    name: "lidlr_consent",
    life: "1 year",
    purpose: "Records that you answered the cookie banner so it stops reappearing.",
  },
  {
    name: "lidlr_devcode",
    life: "15 minutes",
    purpose:
      "Only exists when the server has no email configured (self-hosted testing): the one-time login code is shown on screen instead of being emailed. Never present on a properly configured instance.",
  },
];

export default function CookiesPage() {
  return (
    <div style={{ maxWidth: 760, marginBottom: 40 }}>
      <h1 style={{ margin: "24px 0 8px" }}>Cookie policy</h1>
      <p>
        Lidlr uses <strong>only strictly necessary cookies</strong>. There are no analytics cookies, no advertising
        cookies, no social-media embeds, and no cross-site tracking of any kind — so there is nothing to switch off.
      </p>

      <table className="prices" style={{ marginTop: 18 }}>
        <thead>
          <tr>
            <th>Cookie</th>
            <th>Lifetime</th>
            <th>Purpose</th>
          </tr>
        </thead>
        <tbody>
          {COOKIES.map((c) => (
            <tr key={c.name}>
              <td><code>{c.name}</code></td>
              <td>{c.life}</td>
              <td>{c.purpose}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p style={{ marginTop: 18 }}>
        The banner offers two identical choices — &ldquo;Accept&rdquo; or &ldquo;Essential only&rdquo; — because the
        only cookies we set are essential. It records your answer in <code>lidlr_consent</code> so it doesn&apos;t
        nag you again. You can clear it in your browser at any time; the banner will reappear.
      </p>
      <p>
        See also our <Link href="/privacy">privacy policy</Link> and <Link href="/terms">terms</Link>.
      </p>
    </div>
  );
}
