import { siteUrl } from "./site";

export function emailConfigured() {
  return !!process.env.RESEND_API_KEY;
}

export async function sendLoginCode(to: string, code: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(`[mail] RESEND_API_KEY not set — login code for ${to} not emailed, shown in UI (dev fallback).`);
    return false;
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.ALERT_FROM_EMAIL || "lidlr@example.com",
        to,
        subject: `Lidlr login code: ${code}`,
        text: `Your Lidlr login code is ${code}. It is valid for 15 minutes.\n\nRequested from ${siteUrl()}. If this wasn't you, ignore this email.`,
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
