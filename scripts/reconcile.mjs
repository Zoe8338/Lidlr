// Re-check stored translations against the primary Google endpoints and fix
// whatever is wrong. Runs automatically every 24 h inside the app; this script
// is for manual runs.
//
//   npm run reconcile
//   npm run reconcile -- --limit=100
//   npm run reconcile -- --dry-run
import { prisma } from "../src/lib/db.ts";
import { reconcileTranslations } from "../src/lib/reconcile.ts";

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=").slice(1).join("=") : dflt;
};

if (!process.env.AUTO_TRANSLATE) {
  console.error("AUTO_TRANSLATE is not enabled — set AUTO_TRANSLATE=1. Nothing to do.");
  process.exit(1);
}

const summary = await reconcileTranslations({
  limit: Number(arg("limit", "400")),
  dryRun: args.includes("--dry-run"),
});
console.log("RECONCILE SUMMARY", JSON.stringify(summary));
await prisma.$disconnect();
process.exit(0);
