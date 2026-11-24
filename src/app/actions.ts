"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { endSession, hashPassword, startSession, verifyPassword, currentUser } from "@/lib/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function register(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  if (!EMAIL_RE.test(email)) throw new Error("Valid email required");
  if (password.length < 8) throw new Error("Password needs at least 8 characters");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error("This email is already registered");

  const user = await prisma.user.create({ data: { email, passwordHash: hashPassword(password) } });
  await startSession(user.id);
  redirect("/alerts");
}

export async function login(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !verifyPassword(password, user.passwordHash)) throw new Error("Wrong email or password");
  await startSession(user.id);
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

export async function createAlert(formData: FormData) {
  const kind = String(formData.get("kind") || "price_below");
  const user = await currentUser();
  const email = user ? user.email : String(formData.get("email") || "").trim();
  const query = String(formData.get("query") || "").trim() || null;
  const brandSlug = String(formData.get("brandSlug") || "").trim() || null;
  const countryCode = String(formData.get("countryCode") || "").trim() || null;
  const erp = String(formData.get("erp") || "").trim() || null;
  const maxPriceRaw = String(formData.get("maxPrice") || "").trim();
  const maxPrice = maxPriceRaw ? Number(maxPriceRaw.replace(",", ".")) : null;

  if (!EMAIL_RE.test(email)) throw new Error("Valid email required — sign in to use your account email");
  if (kind === "price_below" && (maxPrice == null || Number.isNaN(maxPrice)))
    throw new Error("Price ceiling required for price alerts");

  await prisma.alert.create({
    data: {
      kind: erp ? "product" : kind,
      email,
      userId: user?.id ?? null,
      query: erp ? erp : query ? query.toLowerCase() : null,
      brandSlug,
      countryCode,
      maxPrice: kind === "price_below" ? maxPrice : null,
    },
  });
  revalidatePath("/alerts");
}

export async function toggleAlert(formData: FormData) {
  const id = Number(formData.get("id"));
  const active = String(formData.get("active")) === "1";
  await prisma.alert.update({ where: { id }, data: { active } });
  revalidatePath("/alerts");
}

export async function deleteAlert(formData: FormData) {
  const id = Number(formData.get("id"));
  await prisma.alert.delete({ where: { id } });
  revalidatePath("/alerts");
}
