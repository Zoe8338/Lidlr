"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { currentUser, endSession, issueLoginCode, startSession, verifyLoginCode } from "@/lib/auth";
import { sendLoginCode } from "@/lib/mail";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function requestLogin(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error("Valid email required");
  const code = await issueLoginCode(email);
  const sent = await sendLoginCode(email, code);
  if (!sent) {
    const jar = await cookies();
    jar.set("lidlr_devcode", code, { httpOnly: true, sameSite: "lax", maxAge: 900, path: "/" });
  }
  redirect(`/login/verify?email=${encodeURIComponent(email)}`);
}

export async function confirmLogin(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const code = String(formData.get("code") || "");
  if (!EMAIL_RE.test(email) || !code) throw new Error("Email and code required");
  const userId = await verifyLoginCode(email, code);
  if (!userId) throw new Error("Invalid or expired code — request a new one");
  const jar = await cookies();
  jar.delete("lidlr_devcode");
  await startSession(userId);
  redirect("/alerts");
}

export async function logout() {
  await endSession();
  revalidatePath("/");
  redirect("/");
}

export async function toggleTrack(formData: FormData) {
  const user = await currentUser();
  if (!user) throw new Error("Sign in to track products");
  const erp = String(formData.get("erp") || "");
  const product = await prisma.product.findUnique({ where: { erpNumber: erp } });
  if (!product) throw new Error("Unknown product");
  const existing = await prisma.tracking.findUnique({
    where: { userId_erpNumber: { userId: user.id, erpNumber: erp } },
  });
  if (existing) {
    await prisma.tracking.delete({ where: { id: existing.id } });
  } else {
    await prisma.tracking.create({ data: { userId: user.id, erpNumber: erp } });
  }
  revalidatePath("/alerts");
  revalidatePath(`/products/${erp}`);
}

export async function saveNotifSettings(formData: FormData) {
  const user = await currentUser();
  if (!user) throw new Error("Sign in required");
  const notifyEmail = formData.get("notifyEmail") === "on";
  const rawPhone = String(formData.get("whatsappPhone") || "").trim().replace(/[^+\d]/g, "");
  const whatsappKey = String(formData.get("whatsappKey") || "").trim();
  const notifyWhatsapp = !!rawPhone && !!whatsappKey;
  await prisma.user.update({
    where: { id: user.id },
    data: {
      notifyEmail,
      notifyWhatsapp,
      whatsappPhone: rawPhone || null,
      whatsappKey: whatsappKey || user.whatsappKey,
    },
  });
  revalidatePath("/alerts");
}

export async function deleteAccount() {
  const user = await currentUser();
  if (!user) throw new Error("Sign in required");
  await prisma.user.delete({ where: { id: user.id } });
  await endSession();
  redirect("/");
}

export async function dismissCookies(formData: FormData) {
  const choice = String(formData.get("choice") || "all");
  const jar = await cookies();
  jar.set("lidlr_consent", choice === "essential" ? "essential" : "all", {
    sameSite: "lax",
    maxAge: 365 * 24 * 3600,
    path: "/",
  });
  revalidatePath("/");
}
