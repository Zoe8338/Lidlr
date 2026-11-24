"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function createAlert(formData: FormData) {
  const kind = String(formData.get("kind") || "price_below");
  const email = String(formData.get("email") || "").trim();
  const query = String(formData.get("query") || "").trim() || null;
  const brandSlug = String(formData.get("brandSlug") || "").trim() || null;
  const countryCode = String(formData.get("countryCode") || "").trim() || null;
  const erp = String(formData.get("erp") || "").trim() || null;
  const maxPriceRaw = String(formData.get("maxPrice") || "").trim();
  const maxPrice = maxPriceRaw ? Number(maxPriceRaw.replace(",", ".")) : null;

  if (!EMAIL_RE.test(email) || !kind) throw new Error("Valid email and alert type required");
  if (kind === "price_below" && (maxPrice == null || Number.isNaN(maxPrice))) throw new Error("Price ceiling required for price alerts");

  await prisma.alert.create({
    data: {
      kind: erp ? "product" : kind,
      email,
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
