import { fetchManuals } from "../src/lib/manuals.ts";

const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => {
    const [k, v] = a.slice(2).split("=");
    return [k, v === undefined ? true : v];
  })
);

const countries = args.countries ? String(args.countries).split(",") : undefined;
const summary = await fetchManuals({ countries, maxPerRun: args.max ? Number(args.max) : undefined });
console.log("MANUAL SUMMARY", JSON.stringify(summary));
process.exit(0);
