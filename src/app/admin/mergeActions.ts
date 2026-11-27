"use server";

import { revalidatePath } from "next/cache";
import { currentAdmin } from "@/lib/admin";
import { mergeProducts } from "@/lib/merge";
import { setFlash } from "./flash";

async function guard() {
  const admin = await currentAdmin();
  if (!admin) throw new Error("Forbidden — admin sign-in required");
  return admin;
}

/**
 * Merge from the suggestion cards: erpA/erpB hidden fields + a `keep` radio
 * ("a" or "b") choosing which ERP survives.
 */
export async function adminMergeSuggestion(formData: FormData) {
  await guard();
  const a = String(formData.get("erpA") || "").trim();
  const b = String(formData.get("erpB") || "").trim();
  const keep = String(formData.get("keep") || "a") === "b" ? b : a;
  const drop = keep === a ? b : a;
  const form = new FormData();
  form.set("keep", keep);
  form.set("drop", drop);
  await adminMergeProducts(form);
}

/**
 * Merge product `drop` into product `keep` (see src/lib/merge.ts).
 */
export async function adminMergeProducts(formData: FormData) {
  await guard();
  const keepErp = String(formData.get("keep") || "").trim();
  const dropErp = String(formData.get("drop") || "").trim();
  if (!keepErp || !dropErp) throw new Error("Both products are required");
  try {
    await mergeProducts(keepErp, dropErp);
    setFlash(`Merged ${dropErp} into ${keepErp}: listings, snapshots, trackings, notifications, manuals and offers now belong to ${keepErp}.`);
  } catch (e) {
    setFlash(`Merge failed: ${e instanceof Error ? e.message : String(e)}`, false);
  }
  revalidatePath("/admin");
  revalidatePath("/products");
  revalidatePath(`/products/${keepErp}`);
}

/**
 * Targeted ParkPrice import from the admin Products tab: a list of ParkPrice
 * URLs / slugs / IANs (one per line), optionally creating shell products for
 * pages with no catalog match. Runs synchronously (capped at 25 targets so the
 * request stays short).
 */
export async function adminImportParkPrice(formData: FormData) {
  await guard();
  const raw = String(formData.get("targets") || "");
  const targets = raw
    .split(/[\n,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 25);
  if (!targets.length) {
    setFlash("Paste at least one ParkPrice URL, slug or IAN number.", false);
    revalidatePath("/admin");
    return;
  }
  const createMissing = formData.get("createMissing") === "on";
  const dryRun = formData.get("dryRun") === "on";
  try {
    const { importParkPrice } = await import("@/lib/parkprice");
    const summary = await importParkPrice({ targets, createMissing, dryRun, delay: 1500 });
    const bits = [
      `fetched ${summary.fetched}`,
      `matched ${summary.matched}`,
      summary.created ? `created ${summary.created}` : null,
      summary.notInCatalog ? `not in catalog: ${summary.notInCatalog}` : null,
      summary.notFound ? `not found on ParkPrice: ${summary.notFound}` : null,
      summary.failed ? `failed: ${summary.failed}` : null,
    ].filter(Boolean);
    setFlash(
      `ParkPrice import ${dryRun ? "(dry run) " : ""}— ${bits.join(", ")}.` +
        (summary.notInCatalog && !createMissing ? " Turn on \"create missing products\" to import those as shells." : ""),
      !summary.failed,
    );
  } catch (e) {
    setFlash(`ParkPrice import failed: ${e instanceof Error ? e.message : String(e)}`, false);
  }
  revalidatePath("/admin");
}
