# Deploying burrow to the VPS

burrow runs as three containers (`burrow`, `burrow-vision`, `burrow-db`) next to the other stacks on the shared VPS,
behind the one Caddy that owns ports 80 and 443. Images are built in GitHub Actions and pulled on the box, never built
there. The decisions behind this shape are in [ADR-0005](../adr/0005-deployment-shape.md) (one instance, readiness-gated
rollout) and [ADR-0006](../adr/0006-local-store-encrypted-offsite-backup.md) (the VPS disk is the store of record, with an
encrypted nightly backup on Azure).

| File | Purpose |
| - | - |
| [`vps/deploy.sh`](vps/deploy.sh) | Forced-command deploy: one validated tag in, readiness-gated rollout or rollback out |
| [`vps/Caddyfile.snippet`](vps/Caddyfile.snippet) | The vhost to add to the shared Caddyfile |
| [`vps/backup.sh`](vps/backup.sh), [`burrow-backup.service`](vps/burrow-backup.service), [`burrow-backup.timer`](vps/burrow-backup.timer) | Nightly encrypted database dump and blob copy |
| [`vps/restore-drill.sh`](vps/restore-drill.sh) | Proves a backup restores, on a scratch machine |
| [`../../docker-compose.prod.yml`](../../docker-compose.prod.yml) | The production stack |

## Status of the one-time setup (2026-10-24)

| Step | State |
| - | - |
| GitHub OAuth app | Registered; callbacks for production and `localhost:8080`; id and secret in the VPS `.env` |
| Microsoft app registration | Registered (personal and work accounts, token version 2); 2-year secret in the VPS `.env`, **expires 2028-10-24, rotate before then** |
| Google OAuth client | **Open**: Google blocked automated access to its console, so this one is done by hand (steps in the release checklist) |
| Azure backup account | Created (`burrow-rg`, private Cool-tier container, soft delete and versioning, lifecycle rule) |
| `/opt/burrow`, `.env` (mode 600), compose file, deploy and backup scripts | In place on the VPS |
| Forced-command CI key | Installed; refuses any command that is not a release tag (tested) |
| GitHub `VPS_SSH_KEY` secret and `VPS_HOST` variable | Set |
| metrion key and collector route | Done ([metrion-onboarding.md](metrion-onboarding.md)) |
| Backup credentials on the VPS, `rclone`, GPG key | See "Backups" below |
| Caddy vhost, DNS record, first release | Go-live, see "Releasing" |

## Setup (the full procedure)

1. **DNS**: at GoDaddy add an `A` record `burrow` in `woofi-developments.at` pointing at the VPS (same address as the
   other hostnames, TTL 600). Check with `dig +short burrow.woofi-developments.at`.
2. **Registry**: CI pushes `burrow-api` and `burrow-vision` to GitHub's container registry (`ghcr.io/wolfi-owo/...`)
   with the workflow's own token, so no registry secret exists. After the first push, set both packages to **public**
   (package settings, "Danger zone", change visibility) so the VPS can pull without a login.
3. **Forced-command CI key** on the VPS, in `~deploy/.ssh/authorized_keys`, plus the GitHub secret `VPS_SSH_KEY` and
   variable `VPS_HOST`:

   ```text
   command="/opt/burrow/deploy.sh",restrict ssh-ed25519 AAAA... burrow-ci
   ```

4. **Stack directory**, as the `deploy` user. The data directory must belong to uid 1000, the image's `node` user:

   ```sh
   sudo install -d -o deploy -g deploy -m 755 /opt/burrow
   sudo install -d -o 1000 -g 1000 -m 750 /opt/burrow/data
   cd /opt/burrow     # copy docker-compose.prod.yml, deploy.sh, backup.sh from this repository
   (umask 077; cat > .env) <<'ENV'      # mode 600, never committed
   REGISTRY=ghcr.io/wolfi-owo
   IMAGE_TAG=
   POSTGRES_PASSWORD=<openssl rand -base64 36>
   JWT_SECRET=<openssl rand -base64 48>
   METRICS_TOKEN=<openssl rand -base64 36>
   INTERNAL_SERVICE_TOKEN=<openssl rand -base64 36>
   CORS_ALLOWED_ORIGINS=https://burrow.woofi-developments.at
   OAUTH_FRONTEND_BASE_URL=https://burrow.woofi-developments.at
   REGISTRATION_OPEN=false
   OWNER_SETUP_TOKEN=<openssl rand -base64 30>     # the first account must present this; see "First account"
   GITHUB_CLIENT_ID=...    GITHUB_CLIENT_SECRET=...
   MICROSOFT_CLIENT_ID=... MICROSOFT_CLIENT_SECRET=...
   GOOGLE_CLIENT_ID=...    GOOGLE_CLIENT_SECRET=...      # optional until the Google client exists
   ENV
   ```

   Then add [`vps/Caddyfile.snippet`](vps/Caddyfile.snippet) to `/opt/portfolio/Caddyfile` and reload Caddy with the
   shared `/opt/caddy-reload.sh` (never `docker exec caddy reload`; the script exists because a bind mount of a single
   file follows the inode, not the path).
5. **Metrics**: see [metrion-onboarding.md](metrion-onboarding.md).

## Backups

Everything that leaves the box is encrypted (ADR-0006). On the VPS:

1. `sudo apt-get install -y rclone` (the Ubuntu package supports the `azureblob` and `crypt` backends this needs).
2. Import the **public** GPG key for database dumps (`gpg --import burrow-backup-public.asc`). The private key stays
   on the operator's machine.
3. Write `/opt/burrow/backup.env` (mode 600, `deploy`-owned):

   ```text
   RCLONE_CONFIG_AZ_TYPE='azureblob'
   RCLONE_CONFIG_AZ_SAS_URL='https://<account>.blob.core.windows.net/burrow-backups?<sas>'
   RCLONE_CONFIG_BLOBS_TYPE='crypt'
   RCLONE_CONFIG_BLOBS_REMOTE='az:burrow-backups/blobs'
   RCLONE_CONFIG_BLOBS_PASSWORD='<output of: rclone obscure "<password>">'
   RCLONE_CONFIG_BLOBS_PASSWORD2='<output of: rclone obscure "<salt>">'
   BACKUP_GPG_RECIPIENT='<fingerprint of the public key>'
   ```

   Every value is single-quoted because the file is sourced by a shell and a SAS token contains `&`. The SAS allows read, add, create, write and list, and deliberately not delete; it expires after a year, so renew it
   (`az storage container generate-sas ...`) before then. Keep the crypt password and salt in the operator's password
   store too: without them the backed-up blobs cannot be read.
4. Copy the two units to `/etc/systemd/system/`, `sudo systemctl enable --now burrow-backup.timer`, then run
   `sudo systemctl start burrow-backup.service` once and read `journalctl -u burrow-backup`.
5. Prove it restores: `vps/restore-drill.sh <object>` on a scratch machine, and compare the counts.

## Releasing

A published GitHub Release runs `.github/workflows/release.yml`: it builds both images, pushes them tagged with the
release tag, then connects with the forced-command key and sends the tag. `deploy.sh` rewrites `IMAGE_TAG`, pulls,
restarts, and waits for `/readyz` to answer three times in a row. If it never does, it restores the previous tag and
exits non-zero, so the workflow fails loudly and the old version keeps serving.

Rolling back by hand: re-run the release workflow for the older tag (`workflow_dispatch`), or on the box run
`/opt/burrow/deploy.sh v0.1.0` with the tag you want.

The first start applies the schema (`scripts/run-migrations.mjs` runs before the server). Take a backup first whenever a
release contains a new migration.

## First account

The first account becomes the admin, and a new hostname is public the moment its certificate is issued (certificate
logs are scanned within minutes), so the first registration has to present `OWNER_SETUP_TOKEN` from the server `.env`;
without it the request is refused, and a provider login cannot create the first account either. Open
`https://burrow.woofi-developments.at`, choose "First time here? Create the owner account", enter a username, a
password of 12 or more characters and the token, and register. Registration is then closed for good
(`REGISTRATION_OPEN=false`). Link GitHub or Microsoft from the Profile page afterwards. Nothing is reachable without
signing in.

## Restoring

1. On a scratch machine run `vps/restore-drill.sh <object>` and check the row counts against production.
2. For a real restore, stop the stack, `pg_restore --clean --if-exists --no-owner` the decrypted dump into `burrow-db`,
   `rclone copy blobs: /opt/burrow/data/blobs`, then start the stack again. The recovery point is the last nightly run.

## Verified before shipping

The compose file validates (`docker compose config`, on the VPS too), the dump of the real schema restores into a clean
Postgres with ltree paths and pgvector embeddings intact (row counts compared), and the smoke suite in `e2e/` passes
against the built images, both locally and in CI. The deploy key was shown to refuse any command that is not a release
tag. Verified at go-live and not before: the Caddy vhost, the DNS record, and the encrypted Azure path end to end.
