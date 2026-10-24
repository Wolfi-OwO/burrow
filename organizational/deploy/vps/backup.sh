#!/usr/bin/env bash
# Nightly backup, run by burrow-backup.timer as the `deploy` user.
#
#   1. pg_dump of the database, GPG-encrypted to the backup recipient, into the backup bucket.
#   2. The blob store is copied to the backup bucket with `rclone copy --immutable`.
#
# Why copy, not sync: blobs are content-addressed (ADR-0002), so a key's bytes never change. `copy` never
# deletes on the destination, which means an accidental delete in burrow-blobs cannot propagate to the backup,
# and --immutable makes any attempt to overwrite an existing key a loud error instead of a silent change.
#
# Why rclone and not restic: restic would back up the LOCAL cache, which is only a bounded slice of the data
# (ADR-0002); the store of record is B2, so the backup has to read from B2.
#
# Configuration, from /opt/burrow/backup.env (mode 600, deploy-owned, never in git):
#   RCLONE_CONFIG_BLOBS_*   the read-only application key for burrow-blobs
#   RCLONE_CONFIG_BACKUP_*  the read/write application key for burrow-backups
#   BACKUP_GPG_RECIPIENT    a public key that is NOT stored on this host
set -euo pipefail

cd /opt/burrow
set -a
# shellcheck source=/dev/null
source ./backup.env
set +a

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "[$STAMP] dumping the database"
docker compose -f docker-compose.prod.yml --env-file .env exec -T burrow-db \
    pg_dump -U burrow -d burrow --format=custom --no-owner \
    | gpg --batch --yes --trust-model always --encrypt --recipient "$BACKUP_GPG_RECIPIENT" --output "$WORK/db.dump.gpg"
[ -s "$WORK/db.dump.gpg" ] || { echo "empty database dump, aborting" >&2; exit 1; }
rclone copyto "$WORK/db.dump.gpg" "backup:burrow-backups/db/${STAMP}.dump.gpg"

echo "[$STAMP] copying new blobs"
rclone copy --immutable --transfers 4 "blobs:burrow-blobs/blobs" "backup:burrow-backups/blobs"

# Keep 30 days of database dumps. Blobs are never pruned here (bucket lifecycle owns that).
rclone delete --min-age 30d "backup:burrow-backups/db" || true

echo "[$STAMP] backup finished"
