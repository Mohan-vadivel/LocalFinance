#!/bin/sh
# Daily backup of the database and uploaded files. Run from the repo root, e.g. from cron:
#   30 23 * * * cd /opt/LocalFinance && sh deploy/backup.sh >> /var/log/localfinance-backup.log 2>&1
set -e
DIR=${BACKUP_DIR:-/opt/backups}
STAMP=$(date +%Y-%m-%d)
mkdir -p "$DIR"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db pg_dump -U localfinance -Fc localfinance > "$DIR/db-$STAMP.dump"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T api tar -czf - -C /data uploads > "$DIR/uploads-$STAMP.tgz"
# Keep 30 days
find "$DIR" -name 'db-*.dump' -mtime +30 -delete
find "$DIR" -name 'uploads-*.tgz' -mtime +30 -delete
echo "Backup done: $DIR ($STAMP)"
