#!/bin/sh
# Pull the latest code and rebuild. Run from the repo root: sh deploy/update.sh
# Takes a backup first, so a bad update can be rolled back with deploy/restore.sh.
set -e
BRANCH=${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}
sh deploy/backup.sh
git pull --ff-only origin "$BRANCH"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker image prune -f > /dev/null
echo "Updated to $(git log -1 --format='%h %s')"
