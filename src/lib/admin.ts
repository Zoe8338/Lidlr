// Admin access: determined live from the ADMIN_EMAILS allowlist on every
// request — there is no database flag and nothing stored client-side, so a
// session cookie alone never grants admin rights. The allowlist lives in the
// server's .env (docker compose passes it into the container only).
import { currentUser } from "./auth.ts";

export async function currentAdmin() {
  const user = await currentUser();
  return user && isAdminEmail(user.email) ? user : null;
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}
