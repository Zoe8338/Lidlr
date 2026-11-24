# Lidlr — Lidl EU price tracker

A ParkPrice-style tracker for Lidl's own brands across Europe: **Parkside & Parkside Performance, Esmara &
Esmara Men, Crivit, Livery/Livergy, Cien, SilverCrest (incl. SilverCrest Personal Care and SilverCrest Kitchen
Tools), Dentalux and all things Livarno (Livarno, Livarno Lux, Livarno Home)**.

It crawls Lidl's public online shops, records prices over time, shows weekly promotions and newly launched items,
compares prices between EU countries, and raises alerts when something drops in price, is available again in a
country shop, or appears as a new item.

Not affiliated with Lidl. Data comes from Lidl's own public website; respect their terms, keep the built-in
politeness delay in place, and don't hammer the shops.

## Stack

- Next.js 15 (App Router) + TypeScript, React 19
- Prisma + SQLite (single-file DB, swap to Postgres by changing `prisma/schema.prisma` datasource)
- Crawler uses Lidl's public storefront search API (`/q/api/search`) with a per-country assortment/locale —
  no private APIs, no scraping of disallowed paths (robots.txt is respected; search HTML pages are never hit)
- Built-in scheduler (in-process): weekly full crawl + daily alert evaluation, no cron dependency

## Currency comparison

Lidl prices come in 10 different currencies across the tracked shops. Using the
free ECB reference-rate API (frankfurter.dev, no key, pegged BGN supported),
product pages show every country price in its local currency together with a
`≈ EUR` equivalent, and product cards in lists show the same equivalent, so a
PLN price can be compared against an EUR price at a glance.

## Product images

The crawler stores up to 4 images per product from Lidl's `imageList`; the
product page shows a click-to-swap gallery and cards show the main image.
Images of products already in the DB are backfilled on their next crawl.

## One-command on-prem deploy (Docker)

```bash
docker compose up -d --build
```

That's it: builds the image, syncs the SQLite schema, starts the app on
http://localhost:3000 with the weekly crawl + daily alert scheduler running, and
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

## Accounts & tracking

- Users register with email + password (`/login`); passwords are hashed with
  scrypt, sessions are HMAC-signed httpOnly cookies (30 days).
- Signed-in users can **track products** from any product page with one click
  and manage everything on `/alerts`: tracked products, alert rules, and the
  match feed.
- Alert rules created while signed in belong to the account (no email field):
  matches are still emailed when `RESEND_API_KEY` is set.
- Without `AUTH_SECRET`, a random secret is generated and persisted in
  `data/auth-secret`. Set `AUTH_SECRET` in the compose env if you run multiple
  replicas.

## Auto-translated names

Set `AUTO_TRANSLATE=1` (default in docker-compose) and every newly crawled
product title is translated to `TRANSLATE_TARGET` (default `en`) using the free
Google-translate community endpoint — no key, no dependency. Translations are:

- stored in `Product.titleEn` and cached in-process per title,
- shown on product cards (original underneath) and product pages,
- backfilled on the next crawl for products already in the DB (one-time).

Failures degrade silently — the original name is kept and retried next run.

Optional env vars (put them in a `.env` next to `docker-compose.yml`, plain
shell file format): `RESEND_API_KEY`, `ALERT_FROM_EMAIL`, `SITE_URL`,
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
country), `--alerts` (also evaluate alerts afterwards).

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
| `/products` | Search + filter by brand family, country, price sort |
| `/products/[erp]` | Product detail: per-country price table, cheapest country highlighted, price-history chart, alert shortcut |
| `/deals` | Current promotions (deal of the day, flash sales, promo ribbons, old→new price drops) |
| `/new` | Items first seen within the last 7/14/30/90 days |
| `/alerts` | Create/pause/delete alerts, match feed |

## Alerts

Alert kinds:

- **price ≤ N** — fires when a matching listing's price is at or below a ceiling
- **in stock** — fires when a matching listing shows available in the online shop (this is what Lidl's public
  data exposes; per-store shelf stock is only inside the Lidl Plus app and is not crawled)
- **any new item** — brand-family watcher; fires for newly discovered items

Matching is by brand family, title substring and/or country. Matches are deduplicated per condition. Delivery:

- With `RESEND_API_KEY` set: emails via [Resend](https://resend.com) (set `ALERT_FROM_EMAIL`, and `SITE_URL` for links)
- Without it: matches land in the feed on `/alerts`

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
