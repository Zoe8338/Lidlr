// Archive product images into DATA_DIR/images (like the manual archive).
//
//   npm run images                backfill every product without stored images
//   npm run images -- --max=200   cap products per run
import { fetchImages } from "../src/lib/images.ts";

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=").slice(1).join("=") : dflt;
};
const max = Number(arg("max", "400"));

const res = await fetchImages({ maxPerRun: Number.isFinite(max) ? max : 400 });
console.log("IMAGE SUMMARY", JSON.stringify(res));
process.exit(0);
