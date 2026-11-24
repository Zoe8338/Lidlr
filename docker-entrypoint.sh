#!/bin/sh
set -e

mkdir -p /app/data

echo "[lidlr] syncing database schema..."
if npx prisma db push --skip-generate; then
  echo "[lidlr] schema up to date."
else
  echo "[lidlr] normal push refused (schema requires destructive changes)."
  echo "[lidlr] Retrying with --accept-data-loss: tables/columns removed from the"
  echo "[lidlr] schema (e.g. the old password login) will be dropped. Crawled data,",
  echo "[lidlr] accounts and tracking are preserved."
  npx prisma db push --skip-generate --accept-data-loss
fi

exec npx next start -H 0.0.0.0 -p 3000
