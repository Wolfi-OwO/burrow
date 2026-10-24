#!/usr/bin/env bash
# Proves a backup restores. Run on a scratch machine that has the backup.env values and the GPG private key, never
# against the live stack:
#
#   ./restore-drill.sh <db dump object name, e.g. 20261024T031500Z.dump.gpg>
#
# It restores the dump into a throwaway Postgres container and prints row counts to compare with production, then
# restores a few blobs through the crypt remote and checks each against the hash in its own file name.
set -euo pipefail

OBJECT="${1:?usage: restore-drill.sh <object name>}"
WORK="$(mktemp -d)"
trap 'docker rm -f burrow-restore-drill >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

set -a
# shellcheck source=/dev/null
source "${BACKUP_ENV:-/opt/burrow/backup.env}"
set +a

rclone copyto "az:db/${OBJECT}" "$WORK/db.dump.gpg"
gpg --batch --decrypt --output "$WORK/db.dump" "$WORK/db.dump.gpg"

docker run -d --name burrow-restore-drill -e POSTGRES_PASSWORD=drill pgvector/pgvector:pg16 >/dev/null
until docker exec burrow-restore-drill pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; do sleep 1; done
docker exec burrow-restore-drill psql -U postgres -c 'CREATE DATABASE burrow' >/dev/null
docker cp "$WORK/db.dump" burrow-restore-drill:/tmp/db.dump
docker exec burrow-restore-drill pg_restore -U postgres -d burrow --no-owner /tmp/db.dump

for table in users categories files blobs; do
    printf '%-12s %s\n' "$table" "$(docker exec burrow-restore-drill psql -U postgres -d burrow -Atc "SELECT count(*) FROM $table")"
done

echo "checking up to 5 restored blobs against their own hash"
mkdir "$WORK/blobs"
rclone copy --max-transfer 200M "blobs:" "$WORK/blobs" --max-depth 3 --include '*/*/*' --transfers 4 || true
bad=0
while IFS= read -r file; do
    name="$(basename "$file")"
    if [ "$(sha256sum "$file" | cut -d' ' -f1)" != "$name" ]; then echo "MISMATCH: $file"; bad=1; fi
done < <(find "$WORK/blobs" -type f | head -5)
[ "$bad" = 0 ] && echo "blob hashes match"
