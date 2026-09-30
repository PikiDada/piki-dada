#!/bin/sh
# Nightly Postgres backup. Intended to run on the HOST (via cron), not inside a container --
# it shells out to `docker compose exec` so it needs no DB credentials of its own beyond what
# docker-compose.yml already has.
#
# Usage (crontab -e on the server):
#   0 3 * * * /opt/pikidada/deploy/pg-backup.sh >> /var/log/pikidada-backup.log 2>&1
#
# Keeps the last RETENTION_DAYS dumps locally under BACKUP_DIR. For real disaster recovery,
# also sync BACKUP_DIR to a Hetzner Storage Box or similar off-server location -- a disk
# failure on this machine would otherwise take the backups out along with the database.

set -eu

COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pikidada}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date +%Y-%m-%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"

cd "$COMPOSE_DIR"
# shellcheck disable=SC1091
[ -f .env ] && . ./.env

docker compose exec -T postgres pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB:-pikidada}" \
  | gzip > "$BACKUP_DIR/pikidada_${TIMESTAMP}.sql.gz"

find "$BACKUP_DIR" -name 'pikidada_*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
