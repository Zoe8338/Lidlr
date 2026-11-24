import { prisma } from "./db.ts";

export async function deliverPendingAlertEvents(): Promise<number> {
  const events = await prisma.alertEvent.findMany({
    where: { delivered: false },
    include: { alert: true },
    take: 100,
    orderBy: { createdAt: "asc" },
  });
  let sent = 0;
  const byAlert = new Map<number, typeof events>();
  for (const e of events) {
    const list = byAlert.get(e.alertId) ?? [];
    list.push(e);
    byAlert.set(e.alertId, list);
  }
  for (const [alertId, list] of byAlert) {
    const alert = list[0].alert;
    const lines = list.map((e) => `• ${e.title} — ${e.message}`);
    const ok = await sendEmail(
      alert.email,
      `Lidlr: ${lines.length} new match${lines.length > 1 ? "es" : ""}`,
      `${lines.join("\n")}\n\nManage your alerts: ${siteUrl()}/alerts`,
    );
    if (ok) {
      await prisma.alertEvent.updateMany({ where: { id: { in: list.map((e) => e.id) } }, data: { delivered: true } });
      sent += list.length;
    }
  }
  return sent;
}

export function siteUrl() {
  return process.env.SITE_URL || "http://localhost:3000";
}

async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.ALERT_FROM_EMAIL || "lidlr@example.com",
        to,
        subject,
        text,
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
