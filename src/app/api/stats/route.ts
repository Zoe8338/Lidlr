import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const [products, listings, snapshots, trackings, notifications, runs] = await Promise.all([
    prisma.product.count(),
    prisma.listing.count(),
    prisma.snapshot.count(),
    prisma.tracking.count(),
    prisma.notification.count(),
    prisma.crawlRun.findMany({ orderBy: { startedAt: "desc" }, take: 5 }),
  ]);
  return NextResponse.json({ products, listings, snapshots, trackings, notifications, recentRuns: runs });
}
