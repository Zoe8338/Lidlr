import { prisma } from "./db";
import { siteUrl } from "./site.ts";
type Delivery = { emailed: boolean; whatsapp: boolean };

export async function deliverPendingNotifications(): Promise<{ sent: number; failed: number }> {
  const events = await prisma.notification.findMany({
    where: { emailed: false, whatsapp: false },
    include: { user: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  let sent = 0;
  let failed = 0;
  for (const n of events) {
    const delivery: Delivery = { emailed: false, whatsapp: false };
    if (n.user.notifyEmail) {
      delivery.emailed = await sendEmail(
        n.user.email,
        `Lidlr · ${n.title.slice(0, 60)}`,
        `${n.message}\n${n.erpNumber ? `${siteUrl()}/products/${n.erpNumber}` : siteUrl()}`,
      );
    }
    if (n.user.notifyWhatsapp && n.user.whatsappPhone && n.user.whatsappKey) {
      delivery.whatsapp = await sendWhatsapp(
        n.user.whatsappPhone,
        n.user.whatsappKey,
        `Lidlr: ${n.title}\n${n.message}`,
      );
    }
    await prisma.notification.update({
      where: { id: n.id },
      data: { emailed: n.user.notifyEmail ? delivery.emailed : true, whatsapp: delivery.whatsapp },
    });
    if (delivery.emailed || delivery.whatsapp) sent++;
    else failed++;
  }
  return { sent, failed };
}

async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.ALERT_FROM_EMAIL || "lidlr@example.com", to, subject, text }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// WhatsApp delivery via CallMeBot's free personal gateway.
// Each user registers their number once with @CallMeBot to get a personal key.
async function sendWhatsapp(phone: string, key: string, text: string): Promise<boolean> {
  try {
    const u = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&apikey=${encodeURIComponent(key)}&text=${encodeURIComponent(text.slice(0, 900))}`;
    const r = await fetch(u, { method: "GET", signal: AbortSignal.timeout(10000) });
    return r.ok;
  } catch {
    return false;
  }
}
