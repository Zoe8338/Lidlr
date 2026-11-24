import Link from "next/link";

export const metadata = { title: "Terms — Lidlr" };

export default function TermsPage() {
  const contact = process.env.ALERT_FROM_EMAIL || "the operator's contact address (set ALERT_FROM_EMAIL on this server)";
  return (
    <div style={{ maxWidth: 760, marginBottom: 40 }}>
      <h1 style={{ margin: "24px 0 8px" }}>Terms of use</h1>

      <h2 className="section">What Lidlr is</h2>
      <p>
        Lidlr is an independent, non-commercial price tracker for own-brand products sold in Lidl&apos;s public
        online shops. It is <strong>not affiliated with, endorsed by, or connected to Lidl</strong>. Product names
        and trademarks belong to their owners.
      </p>

      <h2 className="section">Accuracy &amp; availability</h2>
      <p>
        Prices, stock indicators and promotions come from public web pages and are crawled periodically. They may be
        outdated, incomplete or wrong; final prices and availability in your store are the ones shown at Lidl&apos;s
        checkout and in your local shop. In-store shelf availability cannot be seen from the website — our
        &ldquo;in stock&rdquo; signal is the online shop&apos;s availability badge. Lidlr makes no warranty about
        data accuracy and notifies you on a best-effort basis.
      </p>

      <h2 className="section">Your account</h2>
      <p>
        Accounts are passwordless: you sign in with a one-time code sent to your email (in unconfigured self-hosted
        test setups the code is shown on screen instead). Do not sign up with an email address you don&apos;t
        control. You can delete your account and all associated data at any time from the{" "}
        <Link href="/alerts">Tracking page</Link>.
      </p>

      <h2 className="section">Acceptable use</h2>
      <p>
        Don&apos;t abuse the service: no attempts to overload the crawler endpoint or circumvent rate limits, and no
        scraping of this site in bulk. The operator may rate-limit or block abusive clients.
      </p>

      <h2 className="section">Liability</h2>
      <p>
        The software is provided &ldquo;as is&rdquo; under its open-source licence, without warranty of any kind.
        The operator of this instance is not liable for missed notifications, price differences, or any damages
        arising from use of the site.
      </p>

      <h2 className="section">Contact</h2>
      <p>
        Questions, deletion requests or complaints: {contact}. See also the{" "}
        <Link href="/privacy">privacy policy</Link> and <Link href="/cookies">cookie policy</Link>.
      </p>
    </div>
  );
}
