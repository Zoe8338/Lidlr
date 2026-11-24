import { prisma } from "./db.ts";
import { sendMail } from "./mail.ts";
import { siteUrl } from "./site.ts";

type Delivery = { emailed: boolean; whatsapp: boolean };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function notifHtml(title: string, message: string, link: string): string {
  return `
<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px">
  <p style="margin:0 0 4px;font-weight:700;font-size:15px">${esc(title)}</p>
  <p style="margin:0 0 16px;color:#445">${esc(message)}</p>
  <a href="${link}" style="background:#0e62c4;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700;display:inline-block">View on Lidlr</a>
  <p style="margin-top:18px;font-size:12px;color:#8aa0b4">You get this because you track this product on ${siteUrl()}.</p>
</div>`;
}

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
    const link = n.erpNumber ? `${siteUrl()}/products/${n.erpNumber}` : siteUrl();
    if (n.user.notifyEmail) {
      delivery.emailed = await sendMail(
        n.user.email,
        `Lidlr · ${n.title.slice(0, 60)}`,
        `${n.message}\n${link}`,
        notifHtml(n.title, n.message, link),
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
