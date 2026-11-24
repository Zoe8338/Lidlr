#!/bin/sh
# One-command server update for Lidlr.
# Usage:  ./update.sh
# Pulls the latest code from the repo, rebuilds the image, restarts the
# container, and prunes the old image. Data (SQLite DB, session secret)
# persists in the lidlr-data volume.
set -e
cd "$(dirname "$0")"

echo "==> pulling latest code..."
git pull --ff-only

echo "==> rebuilding + restarting container..."
docker compose up -d --build

echo "==> pruning old images..."
docker image prune -f

echo "==> done. Lidlr is live: http://localhost:3000"
