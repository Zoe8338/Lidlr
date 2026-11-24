#!/bin/sh
set -e

mkdir -p /app/data

echo "[lidlr] syncing database schema..."
npx prisma db push --skip-generate

exec npx next start -H 0.0.0.0 -p 3000
