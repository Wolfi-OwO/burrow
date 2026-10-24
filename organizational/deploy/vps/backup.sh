#!/usr/bin/env bash
# Nightly backup, run by burrow-backup.timer as the `deploy` user. Everything leaves the box encrypted.
#
#   1. pg_dump of the database, GPG-encrypted to a public key whose private half is NOT on this host.
#   2. New blobs from /opt/burrow/data/blobs, copied through an rclone `crypt` remote (contents and file names
#      encrypted) into the Azure container.
#
# Why copy, not sync: blobs are content-addressed (ADR-0002), so a key's bytes never change. `copy` never deletes
# on the destination, so an accidental delete here cannot propagate, and --immutable turns an attempted overwrite
# of an existing key into a loud error. The SAS token in use has no delete permission at all, so even a
# compromised host cannot erase backups; old database dumps are expired by the container's lifecycle rule (30 days).
#
# Why the blobs are encrypted with a symmetric key that lives here: it hides the content from the storage provider
# (the point of the exercise: an adult-content category must not depend on a provider's content policy). It does not
# protect against someone who already owns this host, who could read the live data anyway.
#
# Configuration, from /opt/burrow/backup.env (mode 600, deploy-owned, never in git):
#   RCLONE_CONFIG_AZ_*      the container-scoped SAS (see deploy/README.md)
#   RCLONE_CONFIG_BLOBS_*   the crypt remote layered on az:blobs
#   BACKUP_GPG_RECIPIENT    the public key for database dumps
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
rclone copyto "$WORK/db.dump.gpg" "az:db/${STAMP}.dump.gpg"

echo "[$STAMP] copying new blobs"
if [ -d /opt/burrow/data/blobs ]; then
    rclone copy --immutable --transfers 4 /opt/burrow/data/blobs "blobs:"
fi

echo "[$STAMP] backup finished"
