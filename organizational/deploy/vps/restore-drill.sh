#!/usr/bin/env bash
# Proves a backup restores. Run on a scratch machine, never against the live stack:
#   BACKUP_GPG_HOME=... ./restore-drill.sh <db dump object name>
# It restores the dump into a throwaway Postgres container and prints the row counts to compare with production.
set -euo pipefail

OBJECT="${1:?usage: restore-drill.sh <object name, e.g. 20261024T031500Z.dump.gpg>}"
WORK="$(mktemp -d)"
trap 'docker rm -f burrow-restore-drill >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

rclone copyto "backup:burrow-backups/db/${OBJECT}" "$WORK/db.dump.gpg"
gpg --batch --decrypt --output "$WORK/db.dump" "$WORK/db.dump.gpg"

docker run -d --name burrow-restore-drill -e POSTGRES_PASSWORD=drill pgvector/pgvector:pg16 >/dev/null
until docker exec burrow-restore-drill pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; do sleep 1; done
docker exec burrow-restore-drill psql -U postgres -c 'CREATE DATABASE burrow' >/dev/null
docker cp "$WORK/db.dump" burrow-restore-drill:/tmp/db.dump
docker exec burrow-restore-drill pg_restore -U postgres -d burrow --no-owner /tmp/db.dump

for table in users categories files blobs; do
    printf '%-12s %s\n' "$table" "$(docker exec burrow-restore-drill psql -U postgres -d burrow -Atc "SELECT count(*) FROM $table")"
done
