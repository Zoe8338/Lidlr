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
