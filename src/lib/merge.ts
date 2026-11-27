// Merge one product into another: every reference (listings, snapshots,
// trackings, notifications, manuals, leaflet offers) is re-pointed to the kept
// product, empty fields are filled from the dropped one, IAN/image lists are
// unioned, and the dropped product is deleted. One transaction, FK-safe.
import { prisma } from "./db.ts";

function parseJsonArray(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export async function mergeProducts(keepErp: string, dropErp: string): Promise<void> {
  if (keepErp === dropErp) throw new Error("Cannot merge a product into itself");
  const keep = await prisma.product.findUnique({ where: { erpNumber: keepErp } });
  const drop = await prisma.product.findUnique({ where: { erpNumber: dropErp } });
  if (!keep) throw new Error(`Unknown product ${keepErp}`);
  if (!drop) throw new Error(`Unknown product ${dropErp}`);

  await prisma.$transaction(async (tx) => {
    // --- listings & their snapshots ------------------------------------------
    const keepListings = await tx.listing.findMany({ where: { erpNumber: keepErp }, select: { id: true, countryCode: true } });
    const keepByCountry = new Map(keepListings.map((l) => [l.countryCode, l.id]));
    const dropListings = await tx.listing.findMany({ where: { erpNumber: dropErp }, select: { id: true, countryCode: true } });
    for (const l2 of dropListings) {
      const keepListingId = keepByCountry.get(l2.countryCode);
      if (keepListingId == null) {
        // keep has no listing for this country — adopt the whole listing
        await tx.snapshot.updateMany({ where: { listingId: l2.id }, data: { erpNumber: keepErp } });
        await tx.listing.update({ where: { id: l2.id }, data: { erpNumber: keepErp } });
        keepByCountry.set(l2.countryCode, l2.id);
      } else {
        // both exist — keep the "keep" listing, move the snapshots over
        await tx.snapshot.updateMany({ where: { listingId: l2.id }, data: { listingId: keepListingId, erpNumber: keepErp } });
        await tx.listing.delete({ where: { id: l2.id } });
      }
    }
    // safety net: any snapshot rows still pointing at drop by erpNumber alone
    await tx.snapshot.updateMany({ where: { erpNumber: dropErp }, data: { erpNumber: keepErp } });

    // --- trackings (unique per user+product: users already tracking keep lose their duplicate)
    const dropTrackings = await tx.tracking.findMany({ where: { erpNumber: dropErp }, select: { id: true, userId: true } });
    const keepTrackingUsers = new Set(
      (await tx.tracking.findMany({ where: { erpNumber: keepErp }, select: { userId: true } })).map((t) => t.userId),
    );
    for (const t of dropTrackings) {
      if (keepTrackingUsers.has(t.userId)) await tx.tracking.delete({ where: { id: t.id } });
      else await tx.tracking.update({ where: { id: t.id }, data: { erpNumber: keepErp } });
    }

    // --- notifications, manuals, leaflet offers -------------------------------
    await tx.notification.updateMany({ where: { erpNumber: dropErp }, data: { erpNumber: keepErp } });
    const dropManuals = await tx.manual.findMany({ where: { erpNumber: dropErp }, select: { id: true, url: true } });
    const keepManualUrls = new Set(
      (await tx.manual.findMany({ where: { erpNumber: keepErp }, select: { url: true } })).map((m) => m.url),
    );
    for (const m of dropManuals) {
      if (keepManualUrls.has(m.url)) await tx.manual.delete({ where: { id: m.id } });
      else await tx.manual.update({ where: { id: m.id }, data: { erpNumber: keepErp } });
    }
    await tx.leafletOffer.updateMany({ where: { erpNumber: dropErp }, data: { erpNumber: keepErp } });

    // --- merge fields onto keep, then remove drop ------------------------------
    const ians = [...new Set([...parseJsonArray(keep.ians), ...parseJsonArray(drop.ians)])];
    const images = [...new Set([...parseJsonArray(keep.images), ...parseJsonArray(drop.images)])];
    const storedImages = [...new Set([...parseJsonArray(keep.storedImages), ...parseJsonArray(drop.storedImages)])];
    const minDate = (a: Date | null, b: Date | null) => (a && b ? (a < b ? a : b) : a ?? b);
    const maxDate = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : a ?? b);
    await tx.product.update({
      where: { erpNumber: keepErp },
      data: {
        title: keep.title || drop.title,
        titleEn: keep.titleEn ?? drop.titleEn,
        description: keep.description ?? drop.description,
        descriptionEn: keep.descriptionEn ?? drop.descriptionEn,
        specs: keep.specs ?? drop.specs,
        specsEn: keep.specsEn ?? drop.specsEn,
        brandName: keep.brandName ?? drop.brandName,
        brandSlug: keep.brandSlug ?? drop.brandSlug,
        category: keep.category ?? drop.category,
        imageUrl: keep.imageUrl ?? drop.imageUrl,
        images: images.length ? JSON.stringify(images) : keep.images,
        storedImages: storedImages.length ? JSON.stringify(storedImages) : keep.storedImages,
        ians: ians.length ? JSON.stringify(ians) : keep.ians,
        firstSeen: minDate(keep.firstSeen, drop.firstSeen) ?? keep.firstSeen,
        lastSeen: maxDate(keep.lastSeen, drop.lastSeen) ?? keep.lastSeen,
        removed: keep.removed && drop.removed,
        manualCheckedAt: minDate(keep.manualCheckedAt, drop.manualCheckedAt),
      },
    });
    await tx.product.delete({ where: { erpNumber: dropErp } });
  });
}

// ---- duplicate detection (admin suggestions) --------------------------------

export type MergeSuggestion = {
  keep: string;
  drop: string;
  reasons: string[];
  score: number;
};

function normTitle(t: string | null | undefined): string {
  return (t || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenKey(t: string): string {
  const stop = new Set(["the", "a", "an", "and", "of", "for", "with", "set"]);
  const toks = [...new Set(normTitle(t).split(" ").filter((w) => w.length > 1 && !stop.has(w)))].sort();
  return toks.join(" ");
}

/**
 * Suggest product pairs that look like duplicates: overlapping IAN numbers
 * (strong signal — includes crawler products vs IAN-keyed ParkPrice shells)
 * and identical/same-word titles. Cheap, index-free grouping over the catalog.
 */
export async function findMergeSuggestions(limit = 12): Promise<MergeSuggestion[]> {
  const products = await prisma.product.findMany({
    select: { erpNumber: true, title: true, titleEn: true, ians: true, firstSeen: true, removed: true },
    orderBy: { firstSeen: "asc" },
  });

  const byIan = new Map<string, string[]>();
  const byTokens = new Map<string, string[]>();
  const erpOf = new Map(products.map((p) => [p.erpNumber, p]));
  for (const p of products) {
    for (const i of parseJsonArray(p.ians)) {
      const list = byIan.get(i) ?? [];
      list.push(p.erpNumber);
      byIan.set(i, list);
    }
    const key = tokenKey(p.titleEn || p.title);
    if (key.split(" ").length >= 3) {
      const list = byTokens.get(key) ?? [];
      list.push(p.erpNumber);
      byTokens.set(key, list);
    }
  }

  const pairs = new Map<string, { reasons: Set<string>; score: number }>();
  const addPair = (a: string, b: string, reason: string, score: number) => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const entry = pairs.get(key) ?? { reasons: new Set<string>(), score: 0 };
    entry.reasons.add(reason);
    entry.score += score;
    pairs.set(key, entry);
  };
  for (const [, erps] of byIan) {
    if (erps.length < 2 || erps.length > 4) continue; // huge groups = shared generic IAN, skip
    for (let i = 0; i < erps.length; i++)
      for (let j = i + 1; j < erps.length; j++) addPair(erps[i], erps[j], "same IAN article number", 3);
  }
  for (const [, erps] of byTokens) {
    if (erps.length < 2 || erps.length > 4) continue;
    for (let i = 0; i < erps.length; i++)
      for (let j = i + 1; j < erps.length; j++) addPair(erps[i], erps[j], "same title words", 1);
  }

  return [...pairs.entries()]
    .map(([key, v]) => {
      const [a, b] = key.split("|");
      const pa = erpOf.get(a)!;
      const pb = erpOf.get(b)!;
      // prefer keeping the real crawled ERP (shells are IAN-keyed), else the older one
      const aShell = a.startsWith("IAN-");
      const bShell = b.startsWith("IAN-");
      const keep = aShell && !bShell ? b : bShell && !aShell ? a : pa.firstSeen <= pb.firstSeen ? a : b;
      const drop = keep === a ? b : a;
      return { keep, drop, reasons: [...v.reasons], score: v.score };
    })
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}
