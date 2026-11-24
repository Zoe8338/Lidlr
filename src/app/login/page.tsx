import Link from "next/link";
import { requestLogin } from "@/app/actions";
import { emailConfigured } from "@/lib/mail";

export const metadata = { title: "Sign in — Lidlr" };

export default function LoginPage() {
  return (
    <div style={{ maxWidth: 460, margin: "40px auto" }}>
      <h1>Sign in</h1>
      <p className="notice">
        No passwords, no registration. Enter your email, we&apos;ll send you a one-time 6-digit code, and you&apos;re
        in. Your email is stored so we can send tracking notifications — nothing else, and your password never is,
        because there isn&apos;t one.
      </p>

      <form action={requestLogin} className="inline" style={{ display: "grid", gap: 10, maxWidth: 420 }}>
        <input name="email" type="email" required placeholder="you@example.com" />
        <button type="submit">Email me a login code</button>
      </form>

      {!emailConfigured() ? (
        <p className="notice" style={{ marginTop: 16 }}>
          <strong>Server note:</strong> no email provider is configured (SMTP or Resend), so login codes are delivered
          in-place on the next screen instead of by email. This works for local testing but is not private — set{" "}
          <code>SMTP_HOST</code> or <code>RESEND_API_KEY</code> for real use. Already have a code?{" "}
          <Link href="/login/verify">Enter it here</Link>.
        </p>
      ) : null}
    </div>
  );
}
