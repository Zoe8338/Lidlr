import { login, register } from "@/app/actions";

export default function LoginPage() {
  return (
    <div style={{ maxWidth: 420, margin: "40px auto" }}>
      <h1>Sign in</h1>
      <p style={{ color: "var(--muted)" }}>Track products and manage alerts from any device.</p>

      <h2 className="section">Sign in</h2>
      <form action={login} className="inline" style={{ display: "grid", gap: 10 }}>
        <input name="email" type="email" required placeholder="you@example.com" />
        <input name="password" type="password" required placeholder="Password" />
        <button type="submit">Sign in</button>
      </form>

      <h2 className="section">Create an account</h2>
      <form action={register} className="inline" style={{ display: "grid", gap: 10 }}>
        <input name="email" type="email" required placeholder="you@example.com" />
        <input name="password" type="password" required minLength={8} placeholder="Password (min 8 characters)" />
        <button type="submit">Create account</button>
      </form>
    </div>
  );
}
