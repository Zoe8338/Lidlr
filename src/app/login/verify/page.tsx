import Link from "next/link";
import { cookies } from "next/headers";
import { confirmLogin, requestLogin } from "@/app/actions";

export const metadata = { title: "Enter code — Lidlr" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ email?: string; next?: string }> }) {
  const sp = await searchParams;
  const email = sp.email ?? "";
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "";
  const jar = await cookies();
  const devcode = jar.get("lidlr_devcode")?.value;

  return (
    <div style={{ maxWidth: 460, margin: "40px auto" }}>
      <h1>Enter your code</h1>
      <p style={{ color: "var(--muted)" }}>
        We {devcode ? "generated" : "emailed"} a 6-digit code{email ? ` for ${email}` : ""}. It is valid for 15
        minutes.
      </p>

      {devcode ? (
        <p className="notice">
          <strong>Dev fallback</strong> (email not configured): your code is <code style={{ fontSize: 22 }}>{devcode}</code>
        </p>
      ) : null}

      <form action={confirmLogin} className="inline" style={{ display: "grid", gap: 10, maxWidth: 420 }}>
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="next" value={next} />
        <input
          name="code"
          required
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="6-digit code"
          style={{ letterSpacing: 6, fontSize: 20 }}
        />
        <button type="submit">Sign in</button>
      </form>

      <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span>Didn&apos;t get it?</span>
        <form action={requestLogin} style={{ display: "inline" }}>
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="next" value={next} />
          <button className="button ghost" type="submit">
            Send a new code
          </button>
        </form>
        <Link href="/login">change email</Link>.
      </div>
    </div>
  );
}
