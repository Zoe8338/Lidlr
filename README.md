# Lidlr — Lidl EU price tracker

A ParkPrice-style tracker for Lidl's own brands across Europe: **Parkside & Parkside Performance, Esmara &
Esmara Men, Crivit, Livery/Livergy, Cien, SilverCrest (incl. SilverCrest Personal Care and SilverCrest Kitchen
Tools), Dentalux and all things Livarno (Livarno, Livarno Lux, Livarno Home)**.

It crawls Lidl's public online shops, records prices over time, shows weekly promotions and newly launched items,
compares prices between EU countries, and sends notifications (email or WhatsApp) when a tracked product drops
in price, comes back in stock, or goes on sale.

Not affiliated with Lidl. Data comes from Lidl's own public website; respect their terms, keep the built-in
politeness delay in place, and don't hammer the shops.

## Stack

- Next.js 15 (App Router) + TypeScript, React 19
- Prisma + SQLite (single-file DB, swap to Postgres by changing `prisma/schema.prisma` datasource)
- Crawler uses Lidl's public storefront search API (`/q/api/search`) with a per-country assortment/locale —
  no private APIs, no scraping of disallowed paths (robots.txt is respected; search HTML pages are never hit)
- Built-in scheduler (in-process): weekly full crawl + daily notification evaluation & delivery, no cron dependency

## Currency comparison

Lidl prices come in 10 different currencies across the tracked shops. Using the
free ECB reference-rate API (frankfurter.dev, no key, pegged BGN supported),
**EUR is always the primary price**: product cards and the per-country price
table show the EUR equivalent first, with the local shop currency underneath
(formatted the local way, e.g. «2 999,00 zł» / «4999 Ft»). Cheapest-country,
sorting, min/max filters and the deals "biggest discount %" sort all operate
on the EUR value, so PLN and EUR listings are compared fairly. The price-
history chart follows the same scheme with an **EUR / Local toggle**: EUR mode
plots every country on one shared axis (converted at the current ECB rate,
marked "conv." in the legend); Local mode shows each line in its own currency
— the raw snapshot values, one chart per currency when they differ.

## Product images

The crawler stores up to 4 images per product from Lidl's `imageList`; the
product page shows a click-to-swap gallery and cards show the main image.
Images of products already in the DB are backfilled on their next crawl.

## One-command on-prem deploy (Docker)

```bash
docker compose up -d --build
```

That's it: builds the image, syncs the SQLite schema, starts the app on
http://localhost:3000 with the weekly crawl + daily notification scheduler running, and
keeps the database in the `lidlr-data` volume (survives rebuilds and restarts).

Seed some data from the container:

```bash
docker compose exec lidlr npm run crawl -- --countries=DE,FR --max=200
```

## Server-side updates, one command

```bash
./update.sh
```

Pulls the newest commit from this repo, rebuilds the image, restarts the
container and prunes the old image. The database and session secret live in the
`lidlr-data` volume, so nothing is lost on update.

## Passwordless accounts & tracking

- Users sign in at `/login` with just their **email**: they receive a one-time
  6-digit code (valid 15 minutes, delivered via Resend). **No credentials are
  stored server-side** — login codes are kept only as an HMAC hash and are
  deleted after use, and sessions are HMAC-signed httpOnly cookies (30 days).
- Signed-in users **track products** from any product page with one click.
  Tracking is ParkPrice-style: it watches for **price drops**, **restocks**
  (online-shop availability going back to true) and **new promotions**, and
  creates a notification when a crawl detects a change.
- Notifications are delivered by **email** (your own SMTP server via `SMTP_HOST`,
  or Resend with `RESEND_API_KEY` as fallback) and/or **WhatsApp** via the
  free [CallMeBot](https://www.callmebot.com/blog/free-api-for-whatsapp-messages/)
  gateway (user pastes their number + personal key on the Tracking page).
- ParkPrice-style **target price per product**: optional, means "notify only if
  price < target" (ParkPrice's filter semantics). Empty = notify on any drop.
  Delivery is deduplicated (same message per product within 7 days is skipped).
- Everything is managed on `/alerts`: tracked products, the notification feed
  with delivery status, notification settings, and a self-serve
  "Delete account & all my data" button.
- Without `AUTH_SECRET`, a random secret is generated and persisted in
  `data/auth-secret`. Set `AUTH_SECRET` in the compose env if you run multiple
  replicas.

## Theme & cookies

- Light/dark theme selector in the header; the choice is saved in the
  `lidlr_theme` cookie (1 year) and applied server-side via `data-theme` on
  `<html>` so there's no flash of the wrong theme.
- First visit shows a **cookie consent banner** — Lidlr sets only strictly
  necessary cookies (session, theme, consent, and a transient dev-only login
  code when no email provider is configured). No analytics or ad cookies, ever.
- Legal pages: `/privacy`, `/cookies`, `/terms` — they document collected data,
  third parties, cookies and GDPR-style self-serve deletion.

## Auto-translated names

Set `AUTO_TRANSLATE=1` (default in docker-compose) and every newly crawled
product title is translated to `TRANSLATE_TARGET` (default `en`) using the free
Google-translate community endpoint — no key, no dependency. Translations are:

- stored in `Product.titleEn` and cached in-process per title,
- shown on product cards (original underneath) and product pages,
- backfilled on the next crawl for products already in the DB (one-time),
- optionally enriched with ParkPrice's English titles via the importer below.

Failures degrade silently — the original name is kept and retried next run.

### ParkPrice catalog import (optional)

`npm run parkprice` walks park-price.com's sitemaps (politely: single-threaded,
3 s between requests, resumable) and imports **product metadata only** — English
titles, IAN article numbers, images — for products we also track. Lidl IANs map
ParkPrice pages to our ERP numbers, so an exact match is only recorded when the
IAN is known (crawls fill `Product.ians`); everything else is skipped.
Price/sales history is not imported (anonymous ParkPrice data is geo-scoped).

```bash
# inside the container, against the live database
docker compose exec lidlr npm run parkprice -- --max=500

# dry run / probe a few pages / full pass
npm run parkprice -- --dry-run
npm run parkprice -- --probe=20
npm run parkprice
```

Progress is stored in `data/parkprice-progress.json`, so an interrupted run
resumes where it stopped. Re-run after new crawls to pick up newly matched IANs.

Optional env vars (put them in a `.env` next to `docker-compose.yml`, plain
shell file format): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `RESEND_API_KEY`, `SITE_URL`,
`CRAWL_SECRET`, `SCHEDULER_DISABLED`.

Without Docker Compose (e.g. on a NAS or single Docker host):

```bash
docker build -t lidlr .
docker run -d --name lidlr -p 3000:3000 -v lidlr-data:/app/data --restart unless-stopped lidlr
```

## Setup

```bash
npm install
npm run db:push      # create dev.db from the Prisma schema
npm run dev          # http://localhost:3000
```

Seed the database:

```bash
npm run crawl -- --countries=DE,FR,ES --brands=parkside,livarno --max=200
```

Flags: `--countries=DE,FR,ES`, `--brands=parkside,crivit,livarno`, `--max=200` (max items per brand query per
country), `--notify` (also evaluate tracked products and deliver notifications afterwards),
`--leaflets` (also archive the countries' leaflets + their extracted offers).

Fetch the leaflet archive (PDFs into `data/leaflets/`):

```bash
npm run leaflets -- --countries=DE,PT   # add --nopdf for covers/metadata only, --notify to alert leaflet matches
```

Trigger programmatically:

```bash
curl -X POST http://localhost:3000/api/crawl \
  -H 'content-type: application/json' \
  -H 'x-crawl-secret: YOUR_SECRET' \
  -d '{"countries":["ES"],"brands":["cien"],"maxItemsPerBrand":300}'
```

(Protect with `CRAWL_SECRET` in `.env`; without it, the endpoint is open.)

## Pages

| Route | What it shows |
|---|---|
| `/` | Overview: tracked counts, brand families, latest deals, new arrivals |
| `/products` | ParkPrice-style catalog: table view (Image/Code/Name/Brand/Price/Date) with cards toggle, **Filter modal** (code, name, brand multi, category multi, price with `<`/`>` operators, offer yes/no, online yes/no, country), **Sort modal** (column + asc/desc), page size 24/50/100/200/All, full pagination. Multi-word search across EN/DE/FR/ES/IT/PT synonyms |
| `/products/[erp]` | Product detail: gallery, per-country price table (EUR primary, local secondary), cheapest-country highlight, multi-country price-history chart (EUR/local toggle), tracking popup (ParkPrice-style, editable), manuals & downloads with archived copies |
| `/deals` | Sales page with **This Week / Next Week / All current** toggle: this week's leaflet sales and price drops; Next Week shows announced offers scanned from next week's leaflets; Filter/Sort modals (price `<`/`>` operators, offer/online tri-state), page size, view toggle |
| `/new` | Items first seen within the last 7/14/30/90 days |
| `/archive` | Weekly leaflet (flyer) archive per country: covers, validity dates and stored PDFs |
| `/alerts` | Passwordless sign-in flow, tracked products, notification feed, email/WhatsApp settings |
| `/privacy`, `/cookies`, `/terms` | Legal pages: privacy policy, cookie policy, terms of use |

## Catalog UI (ParkPrice-style)

The products and sales pages mirror ParkPrice's UX: a compact control bar
(search + Filter button with an active-filters badge + Sort button + view
toggle + page-size selector), filtering and sorting open in modals and are
fully URL-driven (shareable/bookmarkable queries), tables are the default view
with a one-click switch to cards, and the price column supports ParkPrice's
operator syntax (`<100`, `>50`, `20-80`). Week boundaries on the sales page are
Monday-based.

## Search & SEO

Search tokenizes every word (AND across tokens) and expands tokens through a
multilingual synonym vocabulary (e.g. `screwdriver` ↔ *Akkuschrauber/Schrauber/*
*parafusadeira/atornillador/visseuse/avvitatore*), matching against the original
title, the auto-translated English title and the brand name — so shoppers can
search in any of the languages Lidl titles arrive in. Plural/singular endings are
forgiven and brand aliases (`livergy` → livery, sub-brand names → families) map
to the right family filter.

For external SEO: `robots.txt` and a dynamic `sitemap.xml` (all product pages)
are generated, every product page emits per-product `<title>`/description/Open
Graph metadata, and `SITE_URL` sets the canonical base URL.

## Mobile

The stylesheet is mobile-first at ≤720px: 2-column product grid, horizontally
scrollable nav and tables, full-width filter fields, compact hero/stats, and
scroll-safe modals. No layout is desktop-only.

## Tracking & notifications

Tracking is ParkPrice-style: click **Track this product** on a product page, and a popup
(like ParkPrice's) lets you narrow the watch: **country** (or any), **Price ≤** target, **on
offer** (unknown / yes / no), **online-only** (unknown / yes / no) and which channels to notify
(email / WhatsApp). Tracking is editable any time from the same popup, and tracked products are
listed on `/alerts`. Signals detected by comparing the two
newest snapshots of each country listing:

- **price drop** — newest price is lower than the previous one
- **restock** — availability flips from out-of-stock to in-stock (this is what Lidl's public
  data exposes; per-store shelf stock is only inside the Lidl Plus app and is not crawled)
- **on sale** — a new promotion ribbon appears (deal of the day, flash sale, % discount, …)
- **in leaflet** — your product turns up in a current or upcoming country leaflet (ParkPrice's
  "in store" alert)

Delivery:

- **Email**: preferred is your **own SMTP server** — set `SMTP_HOST`, `SMTP_PORT`
  (587), `SMTP_USER`, `SMTP_PASS`, `SECURE` (1 for port 465), `MAIL_FROM`
  (Gmail: use an App Password). Without SMTP, Resend (`RESEND_API_KEY`) is used;
  either provider also delivers the login codes. `SITE_URL` builds the links.
- **WhatsApp** via the free [CallMeBot](https://www.callmebot.com/blog/free-api-for-whatsapp-messages/)
  gateway: each user gets their own key from the bot and enters it on the Tracking page
- Without email configured, login codes are shown in the UI (dev fallback) and
  notifications stay in the `pending` feed on `/alerts`

Cartesian dedupe: identical messages for the same product are suppressed for 7 days, and a
single crawl run creates at most 200 notifications.

## Leaflet archive (`/archive`)

The archive is browsable: `/archive` shows a **card per country**; each country page (`/archive/DE`) lists
**years with months as bullets**; clicking a month shows that month's weekly leaflets (cover, validity,
archived PDF, original). Leaflets spanning a month boundary appear under both months.

Every week each Lidl country site publishes national leaflets (folder / prospekt / folleto / volantino). Lidlr
snapshots them into an **archive**:

- Discovery uses Lidl's public leaflet widget API (`esi.leaflets.schwarz/overview`) + flyer JSON API
  (`endpoints.leaflets.schwarz/v4/flyer`) — the same public endpoints the country sites themselves use.
- For every leaflet it stores **name, validity dates, page count, cover image and viewer URL**; with
  `ARCHIVE_LEAFLET_PDF=1` (default) it also **downloads the PDF into `data/leaflets/<CC>/`** (sha256-deduped,
  so unchanged or regional-duplicate files are stored once). PDFs are served from your server at
  `/api/leaflets/<id>/pdf`, so archived flyers remain readable after Lidl deletes them from their site.
- Regional duplicates of the same leaflet are collapsed by name; `LEAFLET_MAX_PER_COUNTRY` (default 6) caps
  how many of the current leaflets are kept per country per fetch.
- Runs automatically after the weekly crawl (same scheduler), one-command manually with
  `npm run leaflets -- --countries=PT,DE` (add `--nopdf` for metadata-only) or via
  `POST /api/leaflets` (`{"countries":["PT"],"downloadPdf":true}`, protected by `CRAWL_SECRET`)
  or the "Fetch latest leaflets" button on `/archive`.

PDFs live in the `lidlr-data` volume (~5–20 MB per leaflet), so they survive updates; set
`ARCHIVE_LEAFLET_PDF=0` if you only want the covers and metadata.

### Leaflet offers

Where Lidl publishes structured product data for a flyer, Lidlr also extracts **each individual
offer** via the same flyer API (`include=products`): title, brand, price, currency and image, and
links it to your catalog through the offer's ERP number. Offer data availability is decided by
Lidl per country (currently rich in e.g. DE / FR / NL, empty in others). Tracked products that
appear in a **current or upcoming** leaflet fire an in-leaflet notification (7-day dedupe, same
caps), so you know your item is in this week's paper before you walk in.

## Product manuals

Many products (mostly tools: Parkside, Silvercrest, …) have official manuals on their Lidl product
page ("Anleitungen & Downloads", served from `manuals.sit-connect.com`). Lidlr archives them:

- A background pass (after the weekly crawl, or `npm run manuals -- --countries=DE --max=50`,
  or `--manuals` on the crawl script / `{"manuals":true}` on `POST /api/crawl`) visits each
  unchecked product's page, extracts every PDF download with its language, and stores a
  **sha256-deduped copy in `data/manuals/`** (max `MANUAL_MAX_PER_PRODUCT` per product,
  `MANUAL_MAX_PDF_MB` cap). `MANUAL_FETCH_PER_RUN` products are checked per run so regular
  crawls stay fast; everything drains over a few runs.
- The product page lists every manual with the **Official ↗** link plus an **Archived copy**
  link (`/api/manuals/<id>`) served from your volume — the PDF stays available even if Lidl
  or SIT takes the original down.
- Products with no manuals are remembered (`manualCheckedAt`) and never re-fetched.

## Crawler mechanics (`src/lib/lidl/`)

- `catalog.ts` — country registry (host, locale, assortment, currency) and the brand taxonomy. EU shops are
  enabled by default; CH/GB are included but disabled.
- `client.ts` — HTTP client with polite delay between page fetches, retries/backoff on 401/429, pagination to
  `fetchsize` limits, and mapping of Lidl's gridbox items into `LidlItem` (price, was-price, stock badges,
  ribbons/promos, images).
- `crawler.ts` — per run: for each enabled country × brand query, page through results, upsert products and
  country listings, write a `Snapshot` per listing per crawl, count new items and price changes, and record a
  `CrawlRun`.

The weekly cadence is the default (`WEEKLY_MS`); change it in `src/lib/scheduler.ts` or disable with
`SCHEDULER_DISABLED=1` and drive crawls yourself via `/api/crawl` from external cron.
