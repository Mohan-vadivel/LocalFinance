#!/bin/sh
# Restore a backup made by deploy/backup.sh. Run from the repo root:
#   sh deploy/restore.sh 2026-10-25
# This replaces the current database and uploaded files with the ones from that day.
set -e
STAMP=${1:?give the backup date, e.g. sh deploy/restore.sh 2026-10-25}
DIR=${BACKUP_DIR:-/opt/backups}
DC="docker compose -f deploy/docker-compose.yml --env-file deploy/.env"
test -f "$DIR/db-$STAMP.dump" || { echo "No backup $DIR/db-$STAMP.dump"; exit 1; }
$DC stop api
$DC exec -T db pg_restore -U localfinance -d localfinance --clean --if-exists --no-owner < "$DIR/db-$STAMP.dump"
if [ -f "$DIR/uploads-$STAMP.tgz" ]; then
  $DC run --rm -T --no-deps --entrypoint sh api -c 'rm -rf /data/uploads/* && tar -xzf - -C /data' < "$DIR/uploads-$STAMP.tgz"
fi
$DC start api
echo "Restored $STAMP"
