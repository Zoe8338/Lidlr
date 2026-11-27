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
    case "parkprice": {
      void runJob("ParkPrice import", async () => {
        const { importParkPrice } = await import("@/lib/parkprice");
        const lines: string[] = [];
        const summary = await importParkPrice({
          max: max ?? 300,
          log: (line) => {
            lines.push(line);
            if (lines.length > 40) lines.shift();
            console.log(`[parkprice] ${line}`);
          },
        });
        return JSON.stringify(summary, null, 2) + (lines.length ? `\nlast log:\n${lines.join("\n")}` : "");
      });
      break;
    }
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
    if (uploaded) {
      pdf = await storePdfBuffer(f.countryCode, flyerId, uploaded);
    } else {
      // no file chosen — adopt a PDF already on the server if one was picked
      const src = path.basename(String(formData.get("src") || ""));
      if (src.endsWith(".pdf")) {
        pdf = await adoptServerPdf(f.countryCode, src, flyerId);
      }
    }
    const row = await prisma.leaflet.create({
      data: {
        ...f,
        flyerId,
        fetchedAt: f.fetchedAt ?? new Date(),
        ...(pdf ? { sha256: pdf.sha256, sizeBytes: pdf.sizeBytes, pdfStored: true, archivedAt: new Date() } : {}),
      },
    });
    setFlash(`Created leaflet #${row.id} (${f.countryCode} · ${f.name})${pdf ? " with archived PDF" : ""}.`);
  } catch (err) {
    setFlash(err instanceof Error ? err.message : String(err), false);
  }
  revalidatePath("/admin");
  revalidatePath("/archive");
}

// Copies (if another leaflet uses the file) or renames (if unclaimed) an
// existing server PDF into place for a leaflet, returning its hash + size.
async function adoptServerPdf(cc: string, src: string, flyerId: string): Promise<{ sha256: string; sizeBytes: number }> {
  const from = path.join(leafletDir(cc), src);
  if (!fs.existsSync(from)) throw new Error("That file is no longer on the server");
  const to = leafletPdfPath(cc, flyerId);
  const claimedBy = await prisma.leaflet.findFirst({
    where: { countryCode: cc, pdfStored: true, flyerId: src.replace(/\.pdf$/, "") },
    select: { id: true },
  });
  if (from !== to) {
    if (claimedBy) fs.copyFileSync(from, to);
    else fs.renameSync(from, to);
  }
  const content = fs.readFileSync(to);
  return { sha256: createHash("sha256").update(content).digest("hex"), sizeBytes: content.length };
}

// One action for both ways of setting a leaflet's archived PDF: an uploaded
// file wins; otherwise the selected server PDF (from the `src` dropdown) is
// used. This is what makes "choose from the menu" actually work.
export async function adminSetLeafletPdf(formData: FormData) {
  await guard();
  try {
    const id = Number(formData.get("id") || 0);
    const leaflet = await prisma.leaflet.findUnique({ where: { id } });
    if (!leaflet) throw new Error("Leaflet not found");
    const buf = await pdfFromForm(formData);
    let sha256: string;
    let sizeBytes: number;
    if (buf) {
      ({ sha256, sizeBytes } = await storePdfBuffer(leaflet.countryCode, leaflet.flyerId, buf));
      setFlash(`Uploaded PDF for #${id} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB).`);
    } else {
      const src = path.basename(String(formData.get("src") || ""));
      if (!src.endsWith(".pdf")) throw new Error("Choose a file to upload or pick a PDF from the server list first");
      ({ sha256, sizeBytes } = await adoptServerPdf(leaflet.countryCode, src, leaflet.flyerId));
      setFlash(`Attached ${src} to leaflet #${id} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB).`);
    }
    await prisma.leaflet.update({
      where: { id },
      data: { sha256, sizeBytes, pdfStored: true, archivedAt: new Date() },
    });
  } catch (err) {
    setFlash(err instanceof Error ? err.message : String(err), false);
  }
  revalidatePath("/admin");
  revalidatePath("/archive");
}

// Media manager: delete a file from data/images, data/leaflets/<CC>/ or
// data/manuals/ and keep the database rows consistent with the disk.
export async function adminDeleteMedia(formData: FormData) {
  await guard();
  try {
    const kind = String(formData.get("kind") || "");
    const file = path.basename(String(formData.get("file") || "")); // basename blocks path traversal
    if (!file) throw new Error("File required");
    if (kind === "image") {
      const p = path.join(dataDir(), "images", file);
      if (!fs.existsSync(p)) throw new Error("File not found");
      fs.rmSync(p);
      setFlash(`Deleted image ${file}. Products that used it fall back to their other images.`);
    } else if (kind === "leaflet") {
      const cc = String(formData.get("cc") || "").toUpperCase();
      if (!/^[A-Z]{2}$/.test(cc)) throw new Error("Country code required");
      const p = path.join(dataDir(), "leaflets", cc, file);
      if (!fs.existsSync(p)) throw new Error("File not found");
      fs.rmSync(p);
      const flyerId = file.replace(/\.pdf$/, "");
      const r = await prisma.leaflet.updateMany({ where: { countryCode: cc, flyerId }, data: { pdfStored: false } });
      setFlash(`Deleted leaflet PDF ${cc}/${file}${r.count ? `; ${r.count} leaflet row(s) now show “cover only”` : ""}.`);
    } else if (kind === "manual") {
      // manuals live in per-product subfolders: data/manuals/<erp>/<sha>.pdf —
      // `file` is the path relative to data/manuals, verified to stay inside it
      const root = path.join(dataDir(), "manuals");
      const p = path.resolve(root, file);
      if (!p.startsWith(root + path.sep)) throw new Error("Invalid path");
      if (!fs.existsSync(p)) throw new Error("File not found");
      const base = path.basename(p);
      fs.rmSync(p);
      try {
        if (fs.readdirSync(path.dirname(p)).length === 0) fs.rmdirSync(path.dirname(p));
      } catch {
        // folder not empty or already gone — fine
      }
      const r = await prisma.manual.updateMany({ where: { storedPath: { contains: base } }, data: { stored: false, storedPath: null } });
      setFlash(`Deleted manual file ${file}${r.count ? `; ${r.count} manual row(s) reset and will re-fetch` : ""}.`);
    } else {
      throw new Error("Unknown media kind");
    }
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
