"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentAdmin } from "@/lib/admin";
import { translateTitle, translateText, translationEnabled } from "@/lib/translate";
import { setFlash } from "./flash";

async function guard() {
  const admin = await currentAdmin();
  if (!admin) throw new Error("Forbidden — admin sign-in required");
  return admin;
}

function clip(v: FormDataEntryValue | null, max = 4000): string | null {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

export async function adminSaveProduct(formData: FormData) {
  await guard();
  const erp = String(formData.get("erp") || "").trim();
  const p = await prisma.product.findUnique({ where: { erpNumber: erp } });
  if (!p) throw new Error("Unknown product");
  await prisma.product.update({
    where: { erpNumber: erp },
    data: {
      title: clip(formData.get("title"), 300) ?? p.title,
      titleEn: clip(formData.get("titleEn"), 300),
      brandName: clip(formData.get("brandName"), 100),
      description: clip(formData.get("description")),
      descriptionEn: clip(formData.get("descriptionEn")),
      specs: clip(formData.get("specs")),
      specsEn: clip(formData.get("specsEn")),
      removed: formData.get("removed") === "on",
    },
  });
  setFlash(`Saved ${erp}.`);
  revalidatePath("/admin");
  revalidatePath(`/products/${erp}`);
}

export async function adminRetranslateProduct(formData: FormData) {
  await guard();
  const erp = String(formData.get("erp") || "").trim();
  const p = await prisma.product.findUnique({ where: { erpNumber: erp } });
  if (!p) throw new Error("Unknown product");
  if (!translationEnabled()) {
    setFlash("Translation is disabled (set AUTO_TRANSLATE=1 and/or MISTRAL_API_KEY / LIBRETRANSLATE_URL).", false);
    revalidatePath("/admin");
    return;
  }
  const parts: string[] = [];
  const titleEn = await translateTitle(p.title);
  if (titleEn) {
    await prisma.product.update({ where: { erpNumber: erp }, data: { titleEn } });
    parts.push("title ✓");
  } else parts.push("title ✗ (provider failed — will retry on the next pass)");
  if (p.description) {
    const descriptionEn = await translateText(p.description);
    if (descriptionEn) {
      await prisma.product.update({ where: { erpNumber: erp }, data: { descriptionEn } });
      parts.push("description ✓");
    } else parts.push("description ✗");
  }
  if (p.specs) {
    const specsEn = await translateText(p.specs);
    if (specsEn) {
      await prisma.product.update({ where: { erpNumber: erp }, data: { specsEn } });
      parts.push("specs ✓");
    } else parts.push("specs ✗");
  }
  setFlash(`Re-translated ${erp}: ${parts.join(", ")}`, parts.every((s) => s.endsWith("✓")));
  revalidatePath("/admin");
  revalidatePath(`/products/${erp}`);
}

export async function adminResetTranslations(formData: FormData) {
  await guard();
  const erp = String(formData.get("erp") || "").trim();
  const p = await prisma.product.findUnique({ where: { erpNumber: erp }, select: { erpNumber: true } });
  if (!p) throw new Error("Unknown product");
  await prisma.product.update({
    where: { erpNumber: erp },
    data: { titleEn: null, descriptionEn: null, specsEn: null },
  });
  setFlash(`Cleared stored translations for ${erp} — the title backfill pass will re-translate it.`);
  revalidatePath("/admin");
}

export async function adminDeleteProduct(formData: FormData) {
  await guard();
  const erp = String(formData.get("erp") || "").trim();
  const p = await prisma.product.findUnique({ where: { erpNumber: erp }, select: { erpNumber: true } });
  if (!p) throw new Error("Unknown product");
  // FK-safe order, same as scripts/prune.mjs
  await prisma.snapshot.deleteMany({ where: { listing: { erpNumber: erp } } });
  await prisma.listing.deleteMany({ where: { erpNumber: erp } });
  await prisma.tracking.deleteMany({ where: { erpNumber: erp } });
  await prisma.notification.deleteMany({ where: { erpNumber: erp } });
  await prisma.manual.deleteMany({ where: { erpNumber: erp } });
  await prisma.product.delete({ where: { erpNumber: erp } });
  setFlash(`Deleted product ${erp} (with its listings, snapshots, trackings, notifications and manuals).`);
  revalidatePath("/admin");
  revalidatePath("/products");
}

export async function adminRefetchDetails(formData: FormData) {
  await guard();
  const erp = String(formData.get("erp") || "").trim();
  const p = await prisma.product.findUnique({ where: { erpNumber: erp }, select: { erpNumber: true, manualCheckedAt: true } });
  if (!p) throw new Error("Unknown product");
  await prisma.product.update({ where: { erpNumber: erp }, data: { description: null, descriptionEn: null, specs: null, specsEn: null, manualCheckedAt: null } });
  setFlash(`Cleared description/specs/manual state for ${erp} — the manuals+descriptions pass will re-fetch them from Lidl.`);
  revalidatePath("/admin");
}
