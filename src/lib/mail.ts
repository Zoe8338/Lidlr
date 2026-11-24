import nodemailer from "nodemailer";
import { siteUrl } from "./site.ts";

export function smtpConfigured(): boolean {
  return !!process.env.SMTP_HOST;
}

export function emailConfigured(): boolean {
  return smtpConfigured() || !!process.env.RESEND_API_KEY;
}

function fromAddress(): string {
  return process.env.MAIL_FROM || process.env.ALERT_FROM_EMAIL || "lidlr@localhost";
}

async function sendSmtp(to: string, subject: string, text: string, html?: string): Promise<boolean> {
  const host = process.env.SMTP_HOST;
  if (!host) return false;
  try {
    const port = Number(process.env.SMTP_PORT || 587);
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: process.env.SMTP_SECURE === "1" || port === 465,
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
    });
    await transport.sendMail({
      from: fromAddress(),
      to,
      subject,
      text,
      ...(html ? { html } : {}),
    });
    return true;
  } catch (e) {
    console.error("[mail] SMTP send failed:", e instanceof Error ? e.message : e);
    return false;
  }
}

async function sendResend(to: string, subject: string, text: string, html?: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const from = fromAddress();
    const payload: Record<string, unknown> = { from, to, subject, text };
    if (html) payload.html = html;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) console.error("[mail] resend failed:", r.status, (await r.text()).slice(0, 300));
    return r.ok;
  } catch {
    return false;
  }
}

export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
  if (smtpConfigured()) return sendSmtp(to, subject, text, html);
  return sendResend(to, subject, text, html);
}

export async function sendLoginCode(to: string, code: string): Promise<boolean> {
  if (!emailConfigured()) {
    console.warn(`[mail] no email provider configured - login code for ${to} shown in UI (dev fallback).`);
    return false;
  }
  const subject = `Lidlr login code: ${code}`;
  const text = `Your Lidlr login code is ${code}. It is valid for 15 minutes.\n\nRequested from ${siteUrl()}. If this wasn't you, ignore this email.`;
  const html = `
<p style="font-size:16px">Your Lidlr login code is:</p>
<p style="font-size:32px;font-weight:800;letter-spacing:6px">${code}</p>
<p style="color:#66768a">Valid for 15 minutes. Requested from ${siteUrl()}.<br/>If this wasn't you, ignore this email.</p>`;
  return sendMail(to, subject, text, html);
}
