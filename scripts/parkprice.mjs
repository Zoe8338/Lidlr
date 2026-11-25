// Import ParkPrice (park-price.com) product data into Lidlr: English titles,
// IAN numbers and images. Gently: single-threaded, seconds between requests,
// robots-compliant (only sitemaps + public product pages; /api/ and /forms/
// are never touched). Progress is cached in data/parkprice-progress.json so
// re-runs never re-download pages.
//
//   npm run parkprice -- --probe=20     sample N pages, report stats, no DB writes
//   npm run parkprice -- --max=500      import at most N product pages
//   npm run parkprice -- --offset=500   resume point into the sitemap list
//   npm run parkprice -- --delay=5000   ms between requests (default 3000)
//   npm run parkprice -- --refetch      ignore cached pages from earlier runs
//   npm run parkprice -- --dry-run      parse + match, write nothing
// IAN numbers come from Lidlr's own crawler (gridbox.data.ians): run a crawl
// first so products carry IANs, then this script can match ParkPrice's pages.
import fs from "fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split("=").slice(1).join("=") : dflt;
};
const has = (name) => args.includes(`--${name}`);
const PROBE = Number(arg("probe", "0"));
const MAX = Number(arg("max", "1e9"));
const DELAY = Number(arg("delay", "3000"));
const OFFSET = Number(arg("offset", "0")) || 0;
const REFETCH = has("refetch");
const DRY = has("dry-run");
const UA = "Lidlr-product-import/1.0 (single-threaded, seconds between requests)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const statePath = new URL("../data/parkprice-progress.json", import.meta.url);
let state = {};
try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch {}
const saveState = () => { try { fs.writeFileSync(statePath, JSON.stringify(state)); } catch {} };

async function fetchText(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: {
          "user-agent": UA,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (r.status === 200) return await r.text();
      if (r.status === 429 || r.status >= 500) {
        console.log(`  HTTP ${r.status} — backing off 60 s`);
        await sleep(60000);
        continue;
      }
      console.log(`  HTTP ${r.status} for ${url}`);
      return null;
    } catch (e) {
      console.log(`  fetch error (${attempt}/3): ${e.message}`);
      await sleep(15000);
    }
  }
  return null;
}

async function productUrls() {
  const all = [];
  for (let p = 1; p <= 32; p++) {
    const xml = await fetchText(`https://www.park-price.com/sitemap-products.xml${p === 1 ? "" : `?p=${p}`}`);
    if (!xml) break;
    const locs = [...xml.matchAll(/<loc>(https:\/\/www\.park-price\.com\/en\/product\/[^<]+)<\/loc>/g)].map((m) =>
      m[1].replace(/ /g, "%20")
    );
    if (!locs.length) break;
    all.push(...locs);
    console.log(`sitemap chunk ${p}: ${locs.length} products`);
    await sleep(DELAY);
  }
  return all;
}

function parseProduct(html) {
  const ian = html.match(/\(IAN ([0-9a-zA-Z]+)\)/)?.[1] ?? null;
  const title =
    html.match(/<h1>([^<]+)<\/h1>/)?.[1]
      ?.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&lt;/g, "<") ?? null;
  const img =
    html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? null;
  // ParkPrice product pages link manuals two ways: a single "btnOpenPDF"
  // button and/or a "Download the file" table of <a class="downloads-link",
  // sometimes several per language both lead to Lidl's media.sit-connect.com
  // PDFs. Accept every .pdf anchor on the page.
  const manuals = [...new Set(
    [...html.matchAll(/<a\b[^>]*href=["']([^"']+\.pdf[^"']*)["'][^>]*>/gi)]
      .map((m) => m[1])
      .filter(Boolean)
  )];
  return { ian, title, img, manuals };
}

async function main() {
  const products = await prisma.product.findMany({ where: { ians: { not: null } }, select: { erpNumber: true, ians: true } });
  const byIan = new Map();
  for (const p of products) {
    try { for (const i of JSON.parse(p.ians || "[]")) if (!byIan.has(i)) byIan.set(i, p.erpNumber); } catch {}
  }
  console.log(`Lidlr catalog: ${byIan.size} unique IANs across ${products.length} products`);

  let urls = await productUrls();
  console.log(`park-price sitemap: ${urls.length} product pages`);
  urls = urls.slice(OFFSET);
  if (Number.isFinite(MAX)) urls = urls.slice(0, MAX);
  console.log(`processing ${urls.length} pages (offset ${OFFSET}, delay ${DELAY} ms)\n`);

  let fetched = 0, cached = 0, updated = 0, matched = 0, notInCatalog = 0, failed = 0, manualsAdded = 0;
  let manualsSeen = 0;

  for (const url of urls) {
    const key = url.replace(/^https?:\/\/www\.park-price\.com\/en\/product\//, "").split("/")[0];
    if (state[key] && !REFETCH) { cached++; continue; }

    await sleep(DELAY);
    const html = await fetchText(url);
    if (!html) { failed++; continue; }
    fetched++;
    const { ian, title, img, manuals } = parseProduct(html);

    const erp = ian ? byIan.get(ian) : null;
    if (PROBE) {
      console.log(`${fetched}/${urls.length} ${title ?? key} | IAN=${ian} ${erp ? "in catalog" : "NOT in catalog"}`);
      state[key] = { ian, title, updated: 0, at: new Date().toISOString() };
      if (fetched % 10 === 0) saveState();
      continue;
    }

    if (!erp) {
      notInCatalog++;
      state[key] = { ian, title, updated: 0, at: new Date().toISOString() };
      if (fetched % 10 === 0) saveState();
      continue;
    }

    let changes = {};
    const p = await prisma.product.findUnique({ where: { erpNumber: erp }, select: { title: true, titleEn: true, imageUrl: true } });
    const englishTitle = (title || "").trim();
    if (englishTitle && !p.titleEn) changes.titleEn = englishTitle;
    if (englishTitle && !p.title) changes.title = englishTitle;
    if (img && !p.imageUrl) changes.imageUrl = img;
    if (Object.keys(changes).length && !DRY) {
      await prisma.product.update({ where: { erpNumber: erp }, data: changes });
      updated++;
    }
    for (const url of manuals) {
      manualsSeen++;
      if (DRY) continue;
      const r = await prisma.manual.upsert({
        where: { erpNumber_url: { erpNumber: erp, url } },
        update: {},
        create: { erpNumber: erp, url, title: "Instruction manual", language: null },
      });
      if (r) manualsAdded++;
    }
    matched++;
    state[key] = { ian, title, erp, manuals, updated: Object.keys(changes).length, at: new Date().toISOString() };
    if (fetched % 10 === 0) saveState();
  }
  saveState();

  if (PROBE) {
    console.log(`\nProbe done. fetched=${fetched} withTitles=${Object.values(state).filter((s) => s.title).length}`);
  } else {
    console.log(`\nDone. fetched=${fetched} cached=${cached} matched=${matched} notInCatalog=${notInCatalog} httpFailed=${failed}`);
    console.log(`products updated: ${DRY ? "(dry-run — nothing written)" : updated}`);
    console.log(`manuals: seen=${manualsSeen} added=${DRY ? "(dry-run)" : manualsAdded}${PROBE ? "" : " (also link on each product page as \"Official\"; archived copies come from Lidlr's own manual fetcher)"}`);
  }
  await prisma.$disconnect();
}

main();
