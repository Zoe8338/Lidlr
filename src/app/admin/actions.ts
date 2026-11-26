"use server";

import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentAdmin } from "@/lib/admin";

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

export async function adminSaveLeaflet(formData: FormData) {
  await guard();
  const id = Number(formData.get("id") || 0);
  if (!id) throw new Error("Leaflet id required");
  const name = String(formData.get("name") || "").trim().slice(0, 200);
  if (!name) throw new Error("Name required");
  const title = String(formData.get("title") || "").trim().slice(0, 200) || null;
  await prisma.leaflet.update({
    where: { id },
    data: { name, title, validFrom: parseDate(formData.get("validFrom")), validUntil: parseDate(formData.get("validUntil")) },
  });
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
