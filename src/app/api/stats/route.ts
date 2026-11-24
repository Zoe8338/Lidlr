import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const [products, listings, snapshots, alerts, runs] = await Promise.all([
    prisma.product.count(),
    prisma.listing.count(),
    prisma.snapshot.count(),
    prisma.alert.count({ where: { active: true } }),
    prisma.crawlRun.findMany({ orderBy: { startedAt: "desc" }, take: 5 }),
  ]);
  return NextResponse.json({ products, listings, snapshots, activeAlerts: alerts, recentRuns: runs });
}
