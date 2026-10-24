# Deploying burrow to the VPS

burrow runs as three containers (`burrow`, `burrow-vision`, `burrow-db`) next to the other stacks on the
shared VPS, behind the one Caddy that owns ports 80 and 443. Images are built in GitHub Actions and pulled on the
box, never built there. The decisions behind this shape are in [ADR-0005](../adr/0005-deployment-shape.md); the
B2 credential design is in [b2-credential-security.md](b2-credential-security.md).

| File | Purpose |
| - | - |
| [`vps/deploy.sh`](vps/deploy.sh) | Forced-command deploy: one validated tag in, readiness-gated rollout or rollback out |
| [`vps/Caddyfile.snippet`](vps/Caddyfile.snippet) | The vhost to add to the shared Caddyfile |
| [`vps/backup.sh`](vps/backup.sh), [`burrow-backup.service`](vps/burrow-backup.service), [`burrow-backup.timer`](vps/burrow-backup.timer) | Nightly database dump and blob copy |
| [`vps/restore-drill.sh`](vps/restore-drill.sh) | Proves a backup restores, on a scratch machine |
| [`../../docker-compose.prod.yml`](../../docker-compose.prod.yml) | The production stack |

## Status of the one-time setup (2026-10-24)

| Step | State |
| - | - |
| GitHub OAuth app | Registered; callback URLs for production and `localhost:8080`; id and secret in the VPS `.env` |
| Microsoft app registration | Registered (personal and work accounts, token version 2); 2-year secret in the VPS `.env`, **expires 2028-10-24, rotate before then** |
| Google OAuth client | **Open**: Google blocked automated access to its console, so this one is done by hand (steps in the release checklist) |
| Backblaze buckets, keys, DPA | **Open**: needs a Backblaze account |
| `/opt/burrow`, `.env` (mode 600), compose file, deploy and backup scripts | In place on the VPS; the compose file validates there |
| Forced-command CI key | Installed; refuses any command that is not a release tag (tested) |
| GitHub `VPS_SSH_KEY` secret and `VPS_HOST` variable | Set |
| Metrion key and collector route | Done ([metrion-onboarding.md](metrion-onboarding.md)) |
| Caddy vhost, DNS record, first release, backup timer | Waiting for the file store, so the first deploy has somewhere to put files |

## One-time setup (the full procedure)

These steps need accounts and secrets that must not pass through the repository or CI logs.

1. **Backblaze B2** (issue #52, follow the checklist in `b2-credential-security.md`): create the private buckets
   `burrow-blobs` and `burrow-backups`, enable versioning with the lifecycle rules described there, and mint three
   bucket-scoped application keys: read/write on `burrow-blobs` (for the API), read-only on `burrow-blobs`, and
   read/write on `burrow-backups` (both for the backup job). The master key never leaves the operator's machine.
2. **DNS** (issue #53): at GoDaddy, add an `A` record `burrow` in `woofi-developments.at` pointing at the VPS (the
   same address the other hostnames use, TTL 600). Do this after step 5, so Caddy has a site to answer the ACME
   challenge for. Check with `dig +short burrow.woofi-developments.at`.
3. **Registry**: CI pushes `burrow-api` and `burrow-vision` to GitHub's container registry
   (`ghcr.io/wolfi-owo/...`) with the workflow's own token, so no registry secret exists. After the first push, set
   both packages to **public** (package settings, "Danger zone", change visibility) so the VPS can pull without a
   login. Add the repository variable `VPS_HOST` and the secret `VPS_SSH_KEY` (a new key used only for burrow, see
   step 4).
4. **Forced-command CI key** on the VPS, in `~deploy/.ssh/authorized_keys`:

   ```text
   command="/opt/burrow/deploy.sh",restrict ssh-ed25519 AAAA... burrow-ci
   ```

5. **Stack directory**, as the `deploy` user:

   ```sh
   sudo install -d -o deploy -g deploy -m 755 /opt/burrow
   cd /opt/burrow
   # from a checkout of this repository
   cp organizational/deploy/vps/deploy.sh organizational/deploy/vps/backup.sh .
   cp docker-compose.prod.yml .
   (umask 077; cat > .env) <<'ENV'   # mode 600, never committed
   REGISTRY=ghcr.io/wolfi-owo
   IMAGE_TAG=v0.1.0
   POSTGRES_PASSWORD=<openssl rand -base64 32>
   JWT_SECRET=<openssl rand -base64 48>
   METRICS_TOKEN=<openssl rand -base64 32>
   INTERNAL_SERVICE_TOKEN=<openssl rand -base64 32>
   CORS_ALLOWED_ORIGINS=https://burrow.woofi-developments.at
   OAUTH_FRONTEND_BASE_URL=https://burrow.woofi-developments.at
   B2_ENDPOINT=https://s3.eu-central-003.backblazeb2.com
   B2_REGION=eu-central-003
   B2_BUCKET=burrow-blobs
   B2_KEY_ID=<read/write key id for burrow-blobs>
   B2_APPLICATION_KEY=<its secret>
   VISION_SERVICE_URL=http://burrow-vision:8000
   ENV
   ```

   Then add the snippet in [`vps/Caddyfile.snippet`](vps/Caddyfile.snippet) to `/opt/portfolio/Caddyfile` and reload
   Caddy with the shared `/opt/caddy-reload.sh` (never `docker exec caddy reload`; the script exists because a bind
   mount of a single file follows the inode, not the path).
6. **Backups** (issue #56): install `rclone` and `gpg`, import the *public* backup key only, write
   `/opt/burrow/backup.env` (mode 600) with the two rclone remotes and `BACKUP_GPG_RECIPIENT`, copy the two systemd
   units to `/etc/systemd/system/`, then `sudo systemctl enable --now burrow-backup.timer`. Run
   `sudo systemctl start burrow-backup.service` once and read `journalctl -u burrow-backup`.
7. **Metrics** (issue #55): see [metrion-onboarding.md](metrion-onboarding.md).

## Releasing

A published GitHub Release runs `.github/workflows/release.yml`: it builds both images, pushes them tagged with the
release tag, then connects with the forced-command key and sends the tag. `deploy.sh` rewrites `IMAGE_TAG`,
pulls, restarts, and waits for `/readyz` to answer three times in a row. If it never does, it restores the previous
tag and exits non-zero, so the workflow fails loudly and the old version keeps serving.

Rolling back by hand: re-run the release workflow for the older tag (`workflow_dispatch`), or on the box run
`sudo -u deploy /opt/burrow/deploy.sh v0.1.0` with the tag you want.

The first start applies the schema (`scripts/run-migrations.mjs` runs before the server). Take a backup first
whenever a release contains a new migration.

## First account

Registration is closed once an account exists. Open `https://burrow.woofi-developments.at`, choose "Create the
owner account" and register: the first account becomes the admin. Nothing is reachable without signing in.

## Restoring

1. On a scratch machine run `vps/restore-drill.sh <object>` and check the row counts against production.
2. For a real restore, stop the stack, `pg_restore --clean --if-exists --no-owner` the decrypted dump into
   `burrow-db`, start it again. Blobs need no restore step: the API reads them from `burrow-blobs`, and
   `rclone copy backup:burrow-backups/blobs blobs:burrow-blobs/blobs` refills the bucket if it was lost.

## Verified before shipping

The compose file validates (`docker compose config`), the dump of the real schema restores into a clean Postgres with
ltree paths and pgvector embeddings intact (row counts compared), and the smoke suite in `e2e/` passes against the
built images. Not verified here: the Caddy vhost, the DNS record and the B2/rclone path, because they need the
credentials above.
