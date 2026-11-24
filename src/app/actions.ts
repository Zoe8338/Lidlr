"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { currentUser, endSession, issueLoginCode, startSession, verifyLoginCode } from "@/lib/auth";
import { sendLoginCode } from "@/lib/mail";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : null;
}

export async function requestLogin(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error("Valid email required");
  const code = await issueLoginCode(email);
  const sent = await sendLoginCode(email, code);
  if (!sent) {
    const jar = await cookies();
    jar.set("lidlr_devcode", code, { httpOnly: true, sameSite: "lax", maxAge: 900, path: "/" });
  }
  const next = safeNext(String(formData.get("next") || ""));
  redirect(
    `/login/verify?email=${encodeURIComponent(email)}${next ? `&next=${encodeURIComponent(next)}` : ""}`,
  );
}

export async function confirmLogin(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const code = String(formData.get("code") || "");
  const next = safeNext(String(formData.get("next") || ""));
  if (!EMAIL_RE.test(email) || !code) throw new Error("Email and code required");
  const userId = await verifyLoginCode(email, code);
  if (!userId) throw new Error("Invalid or expired code — request a new one");
  const jar = await cookies();
  jar.delete("lidlr_devcode");
  await startSession(userId);
  redirect(next ?? "/alerts");
}

function triState(raw: string): boolean | null {
  if (raw === "yes") return true;
  if (raw === "no") return false;
  return null;
}

export async function saveTracking(formData: FormData) {
  const user = await currentUser();
  if (!user) throw new Error("Sign in required");
  const erp = String(formData.get("erp") || "");
  const product = await prisma.product.findUnique({ where: { erpNumber: erp }, select: { erpNumber: true } });
  if (!product) throw new Error("Unknown product");
  const ccRaw = String(formData.get("countryCode") || "").trim().toUpperCase();
  const countryCode = /^[A-Z]{2}$/.test(ccRaw) ? ccRaw : null;
  const rawPrice = String(formData.get("maxPrice") || "").trim();
  const maxPrice = rawPrice === "" ? null : Number(rawPrice.replace(",", "."));
  if (maxPrice != null && (!Number.isFinite(maxPrice) || maxPrice < 0)) throw new Error("Invalid price");
  const offerOnly = triState(String(formData.get("offer") || "any"));
  const onlineOnly = triState(String(formData.get("online") || "any"));
  const notifyEmail = formData.get("notifyEmail") === "on" || formData.get("notifyEmail") === "1";
  const notifyWhatsapp = formData.get("notifyWhatsapp") === "on" || formData.get("notifyWhatsapp") === "1";
  await prisma.tracking.upsert({
    where: { userId_erpNumber: { userId: user.id, erpNumber: erp } },
    update: { countryCode, maxPrice, offerOnly, onlineOnly, notifyEmail, notifyWhatsapp },
    create: {
      userId: user.id,
      erpNumber: erp,
      countryCode,
      maxPrice,
      offerOnly,
      onlineOnly,
      notifyEmail,
      notifyWhatsapp,
    },
  });
  revalidatePath("/alerts");
  revalidatePath(`/products/${erp}`);
  return { ok: true };
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

export async function saveTarget(formData: FormData) {
  const user = await currentUser();
  if (!user) throw new Error("Sign in required");
  const erp = String(formData.get("erp") || "");
  const raw = String(formData.get("maxPrice") || "").trim();
  const maxPrice = raw === "" ? null : Number(raw.replace(",", "."));
  if (maxPrice != null && (!Number.isFinite(maxPrice) || maxPrice < 0)) throw new Error("Invalid price");
  const result = await prisma.tracking.updateMany({
    where: { userId: user.id, erpNumber: erp },
    data: { maxPrice },
  });
  if (result.count === 0) throw new Error("Not tracking this product");
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

export async function fetchLeafletsAction() {
  const { fetchLeaflets } = await import("@/lib/leaflets");
  await fetchLeaflets();
  revalidatePath("/archive");
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
