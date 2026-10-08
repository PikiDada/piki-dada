#!/bin/sh
# Nightly backup of everything that can't be rebuilt: the app's database, the maps platform's
# database (what it has learned about Kampala's roads and places), and uploaded files (rider
# documents in MinIO). Runs on the HOST via cron, using `docker compose`, so it needs no
# credentials beyond the root .env.
#
# Usage (crontab -e on the server; 01:00 UTC = 04:00 Kampala, after the quiet hours):
#   0 1 * * * /opt/pikidada/deploy/backup.sh >> /var/log/pikidada-backup.log 2>&1
#
# Off-server copy: set BACKUP_REMOTE in the root .env to a Hetzner Storage Box folder, e.g.
#   BACKUP_REMOTE="u123456@u123456.your-storagebox.de:pikidada"
# (rsync over SSH on port 23; put this server's SSH public key on the Storage Box first, see
# deploy/README.md). Without it, backups stay on this server only, and a disk failure would
# take them out along with the database, so the script warns every night.
#
# Restoring is in deploy/README.md ("Backups and restoring").

set -eu

COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pikidada}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y-%m-%d_%H%M)"

cd "$COMPOSE_DIR"
# shellcheck disable=SC1091
[ -f .env ] && . ./.env
mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/files"

# Databases, in pg_dump's compressed custom format. Written under a temporary name first, so
# a dump that fails halfway never looks like a good backup.
for db in "${POSTGRES_DB:-pikidada}" maps; do
  out="$BACKUP_DIR/db/${db}_${TIMESTAMP}.dump"
  docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -Fc "$db" > "$out.partial"
  mv "$out.partial" "$out"
done
find "$BACKUP_DIR/db" -name '*.dump' -mtime +"$RETENTION_DAYS" -delete

# Uploaded files: copies new and changed files. Files deleted from MinIO are kept here.
docker compose run --rm --no-deps -T \
  -e MINIO_ROOT_USER="$MINIO_ROOT_USER" -e MINIO_ROOT_PASSWORD="$MINIO_ROOT_PASSWORD" \
  -v "$BACKUP_DIR/files:/backup" --entrypoint /bin/sh minio-init -c \
  "mc alias set local http://minio:9000 \"\$MINIO_ROOT_USER\" \"\$MINIO_ROOT_PASSWORD\" >/dev/null &&
   mc mirror --overwrite --quiet local/${MINIO_BUCKET:-driver-documents} /backup"

if [ -n "${BACKUP_REMOTE:-}" ]; then
  rsync -a -e "ssh -p 23 -o BatchMode=yes" "$BACKUP_DIR/" "$BACKUP_REMOTE/"
  echo "$(date -u) backup done and copied to $BACKUP_REMOTE"
else
  echo "$(date -u) backup done, but ONLY on this server: set BACKUP_REMOTE in .env" >&2
fi
