"use server";

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentAdmin } from "@/lib/admin";
import { setFlash } from "./flash";

// Background job status, shown on the dashboard after it refreshes.
export type AdminJobStatus = {
  name: string;
  startedAt: string;
  finishedAt?: string;
  ok?: boolean;
  detail?: string;
};

const g = globalThis as unknown as { __lidlrAdminJob?: AdminJobStatus | null };

async function guard() {
  const admin = await currentAdmin();
  if (!admin) throw new Error("Forbidden — admin sign-in required");
  return admin;
}

function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || "data");
}

function parseDate(raw: FormDataEntryValue | null): Date | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

async function runJob(name: string, fn: () => Promise<string>) {
  g.__lidlrAdminJob = { name, startedAt: new Date().toISOString() };
  try {
    const detail = await fn();
    g.__lidlrAdminJob = {
      name,
      startedAt: g.__lidlrAdminJob.startedAt,
      finishedAt: new Date().toISOString(),
      ok: true,
      detail,
    };
  } catch (err) {
    g.__lidlrAdminJob = {
      name,
      startedAt: g.__lidlrAdminJob.startedAt,
      finishedAt: new Date().toISOString(),
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  revalidatePath("/admin");
}

export async function adminRunJob(formData: FormData) {
  await guard();
  const job = String(formData.get("job") || "");
  const cc = String(formData.get("cc") || "").trim().toUpperCase() || null;
  const max = Number(formData.get("max") || 0) || undefined;

  const { runCrawl } = await import("@/lib/lidl/crawler");
  const { fetchLeaflets, evaluateLeafletOffers } = await import("@/lib/leaflets");
  const { backfillTitles } = await import("@/lib/backfill");
  const { fetchManuals } = await import("@/lib/manuals");
  const { fetchImages } = await import("@/lib/images");
  const { reconcileTranslations } = await import("@/lib/reconcile");

  switch (job) {
    case "crawl-country":
      if (!cc) throw new Error("Country code required");
      void runJob(`crawl ${cc}`, async () => JSON.stringify(await runCrawl({ countries: [cc], source: "admin" })));
      break;
    case "crawl-all":
      void runJob("crawl all countries", async () =>
        JSON.stringify(await runCrawl({ countries: undefined, source: "admin" })),
      );
      break;
    case "leaflets-country":
      if (!cc) throw new Error("Country code required");
      void runJob(`leaflets ${cc}`, async () =>
        JSON.stringify(await fetchLeaflets({ countries: [cc] })),
      );
      break;
    case "leaflets-all":
      void runJob("leaflets all countries", async () => JSON.stringify(await fetchLeaflets()));
      break;
    case "offers-eval":
      void runJob("re-evaluate leaflet offers", async () =>
        `${await evaluateLeafletOffers()} notifications created`,
      );
      break;
    case "titles":
      void runJob("translate missing titles", async () => {
        const r = await backfillTitles({ max });
        return JSON.stringify(r);
      });
      break;
    case "manuals":
      void runJob("manuals + descriptions", async () =>
        JSON.stringify(await fetchManuals({ maxPerRun: max ?? 150 })),
      );
      break;
    case "images":
      void runJob("archive images", async () =>
        JSON.stringify(await fetchImages({ maxPerRun: max ?? 400 })),
      );
      break;
    case "reconcile":
      void runJob("translation double-check", async () =>
        JSON.stringify(await reconcileTranslations({ limit: max })),
      );
      break;
    default:
      throw new Error("Unknown job");
  }
  revalidatePath("/admin");
}

// ---- Leaflet helpers -------------------------------------------------------

function leafletDir(cc: string): string {
  return path.join(dataDir(), "leaflets", cc);
}

function leafletPdfPath(cc: string, flyerId: string): string {
  return path.join(leafletDir(cc), `${flyerId}.pdf`);
}

function maxPdfMb(): number {
  return Number(process.env.LEAFLET_MAX_PDF_MB || 60);
}

function strOrNull(raw: FormDataEntryValue | null, max = 500): string | null {
  const s = String(raw ?? "").trim();
  return s ? s.slice(0, max) : null;
}

function intOrNull(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// Saves a PDF buffer as the archived copy for a leaflet (used by upload + create).
async function storePdfBuffer(cc: string, flyerId: string, buf: Buffer): Promise<{ sha256: string; sizeBytes: number }> {
  if (buf.subarray(0, 5).toString() !== "%PDF-") throw new Error("Not a PDF file (missing %PDF- header)");
  if (buf.length > maxPdfMb() * 1024 * 1024) throw new Error(`PDF larger than ${maxPdfMb()} MB`);
  fs.mkdirSync(leafletDir(cc), { recursive: true });
  fs.writeFileSync(leafletPdfPath(cc, flyerId), buf);
  return { sha256: createHash("sha256").update(buf).digest("hex"), sizeBytes: buf.length };
}

// Shared field parser for create + edit: every Leaflet column is editable.
function leafletFields(formData: FormData) {
  return {
    name: String(formData.get("name") || "").trim().slice(0, 200),
    title: strOrNull(formData.get("title"), 200),
    flyerId: String(formData.get("flyerId") || "").trim().slice(0, 64),
    countryCode: String(formData.get("countryCode") || "").trim().toUpperCase().slice(0, 2),
    validFrom: parseDate(formData.get("validFrom")),
    validUntil: parseDate(formData.get("validUntil")),
    coverUrl: strOrNull(formData.get("coverUrl")),
    pdfUrl: strOrNull(formData.get("pdfUrl")),
    viewUrl: strOrNull(formData.get("viewUrl")),
    pages: intOrNull(formData.get("pages")),
    sizeBytes: intOrNull(formData.get("sizeBytes")),
    sha256: strOrNull(formData.get("sha256"), 64),
    pdfStored: formData.get("pdfStored") === "on",
    archivedAt: parseDate(formData.get("archivedAt")),
    fetchedAt: parseDate(formData.get("fetchedAt")),
  };
}

async function pdfFromForm(formData: FormData): Promise<Buffer | null> {
  const f = formData.get("pdf");
  if (!(f instanceof File) || f.size === 0) return null;
  return Buffer.from(await f.arrayBuffer());
}

export async function adminSaveLeaflet(formData: FormData) {
  await guard();
  try {
    const id = Number(formData.get("id") || 0);
    if (!id) throw new Error("Leaflet id required");
    const prev = await prisma.leaflet.findUnique({ where: { id } });
    if (!prev) throw new Error("Leaflet no longer exists");
    const f = leafletFields(formData);
    if (!f.name) throw new Error("Name is required");
    if (!/^[A-Z]{2}$/.test(f.countryCode)) throw new Error("Country code must be two letters (e.g. PT)");
    if (!f.flyerId) throw new Error("Flyer ID is required");

    // If the PDF was archived and its location key changed, move the file too.
    if (prev.pdfStored && (prev.countryCode !== f.countryCode || prev.flyerId !== f.flyerId)) {
      const from = leafletPdfPath(prev.countryCode, prev.flyerId);
      if (fs.existsSync(from)) {
        fs.mkdirSync(leafletDir(f.countryCode), { recursive: true });
        fs.renameSync(from, leafletPdfPath(f.countryCode, f.flyerId));
      }
    }

    // fetchedAt is non-nullable: empty input keeps the existing value
    const { fetchedAt, ...rest } = f;
    const base = { ...rest, ...(fetchedAt ? { fetchedAt } : {}) };
    const uploaded = await pdfFromForm(formData);
    if (uploaded) {
      const { sha256, sizeBytes } = await storePdfBuffer(f.countryCode, f.flyerId, uploaded);
      await prisma.leaflet.update({
        where: { id },
        data: { ...base, sha256, sizeBytes, pdfStored: true, archivedAt: f.archivedAt ?? new Date() },
      });
    } else {
      await prisma.leaflet.update({ where: { id }, data: base });
    }
    setFlash(`Saved leaflet #${id} (${f.countryCode} · ${f.name}).`);
  } catch (err) {
    setFlash(err instanceof Error ? err.message : String(err), false);
  }
  revalidatePath("/admin");
  revalidatePath("/archive");
}

export async function adminCreateLeaflet(formData: FormData) {
  await guard();
  try {
    const f = leafletFields(formData);
    if (!f.name) throw new Error("Name is required");
    if (!/^[A-Z]{2}$/.test(f.countryCode)) throw new Error("Country code must be two letters (e.g. PT)");
    const flyerId = f.flyerId || randomUUID();
    const uploaded = await pdfFromForm(formData);
    let pdf: { sha256: string; sizeBytes: number } | null = null;
    if (uploaded) pdf = await storePdfBuffer(f.countryCode, flyerId, uploaded);
    const row = await prisma.leaflet.create({
      data: {
        ...f,
        flyerId,
        fetchedAt: f.fetchedAt ?? new Date(),
        ...(pdf ? { sha256: pdf.sha256, sizeBytes: pdf.sizeBytes, pdfStored: true, archivedAt: new Date() } : {}),
      },
    });
    setFlash(`Created leaflet #${row.id} (${f.countryCode} · ${f.name}).`);
  } catch (err) {
    setFlash(err instanceof Error ? err.message : String(err), false);
  }
  revalidatePath("/admin");
  revalidatePath("/archive");
}

export async function adminUploadLeafletPdf(formData: FormData) {
  await guard();
  try {
    const id = Number(formData.get("id") || 0);
    const leaflet = await prisma.leaflet.findUnique({ where: { id } });
    if (!leaflet) throw new Error("Leaflet not found");
    const buf = await pdfFromForm(formData);
    if (!buf) throw new Error("Choose a PDF file first");
    const { sha256, sizeBytes } = await storePdfBuffer(leaflet.countryCode, leaflet.flyerId, buf);
    await prisma.leaflet.update({
      where: { id },
      data: { sha256, sizeBytes, pdfStored: true, archivedAt: new Date() },
    });
    setFlash(`PDF stored for #${id} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB).`);
  } catch (err) {
    setFlash(err instanceof Error ? err.message : String(err), false);
  }
  revalidatePath("/admin");
  revalidatePath("/archive");
}

export async function adminAttachServerPdf(formData: FormData) {
  await guard();
  try {
    const id = Number(formData.get("id") || 0);
    const leaflet = await prisma.leaflet.findUnique({ where: { id } });
    if (!leaflet) throw new Error("Leaflet not found");
    const src = path.basename(String(formData.get("src") || "")); // basename blocks path traversal
    if (!src.endsWith(".pdf")) throw new Error("Pick a PDF from the list");
    const from = path.join(leafletDir(leaflet.countryCode), src);
    if (!fs.existsSync(from)) throw new Error("That file is no longer on the server");
    const to = leafletPdfPath(leaflet.countryCode, leaflet.flyerId);
    if (from !== to) fs.renameSync(from, to);
    const buf = fs.readFileSync(to);
    await prisma.leaflet.update({
      where: { id },
      data: {
        sha256: createHash("sha256").update(buf).digest("hex"),
        sizeBytes: buf.length,
        pdfStored: true,
        archivedAt: new Date(),
      },
    });
    setFlash(`Attached ${src} to leaflet #${id}.`);
  } catch (err) {
    setFlash(err instanceof Error ? err.message : String(err), false);
  }
  revalidatePath("/admin");
  revalidatePath("/archive");
}

export async function adminDeleteLeaflet(formData: FormData) {
  await guard();
  const id = Number(formData.get("id") || 0);
  if (!id) throw new Error("Leaflet id required");
  const leaflet = await prisma.leaflet.findUnique({ where: { id } });
  if (!leaflet) return;
  if (leaflet.pdfStored) {
    const file = path.join(dataDir(), "leaflets", leaflet.countryCode, `${leaflet.flyerId}.pdf`);
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // file already gone — fine
    }
  }
  await prisma.leaflet.delete({ where: { id } });
  revalidatePath("/admin");
  revalidatePath("/archive");
}
