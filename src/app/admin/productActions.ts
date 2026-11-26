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
      // specs are managed by the dedicated info-table editor; keep the stored
      // value when the raw fields aren't part of the submitted form
      specs: formData.has("specs") ? clip(formData.get("specs")) : p.specs,
      specsEn: formData.has("specsEn") ? clip(formData.get("specsEn")) : p.specsEn,
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

export async function adminSaveSpecs(formData: FormData) {
  await guard();
  const erp = String(formData.get("erp") || "").trim();
  const p = await prisma.product.findUnique({ where: { erpNumber: erp }, select: { erpNumber: true } });
  if (!p) throw new Error("Unknown product");

  const count = Number(formData.get("specCount") || 0);
  const rows: { k: string; v: string }[] = [];
  const seen = new Set<string>();
  const push = (rawK: FormDataEntryValue | null, rawV: FormDataEntryValue | null) => {
    const k = String(rawK ?? "").trim().slice(0, 100);
    const v = String(rawV ?? "").trim().slice(0, 300);
    if (!k && !v) return;
    const key = k.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ k, v });
  };
  for (let i = 0; i < count; i++) {
    if (formData.get(`specDel${i}`) === "on") continue;
    push(formData.get(`specK${i}`), formData.get(`specV${i}`));
  }
  // up to three brand-new rows per save
  for (let i = 0; i < 3; i++) {
    push(formData.get(`newK${i}`), formData.get(`newV${i}`));
  }

  const json = rows.length ? JSON.stringify(rows) : null;
  // written to both columns so the site always shows the (English) table
  await prisma.product.update({ where: { erpNumber: erp }, data: { specs: json, specsEn: json } });
  setFlash(`Saved info table for ${erp}: ${rows.length} row${rows.length === 1 ? "" : "s"}.`);
  revalidatePath("/admin");
  revalidatePath(`/products/${erp}`);
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
