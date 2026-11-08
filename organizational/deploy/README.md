# Deploying burrow to the VPS

burrow runs as three containers (`burrow`, `burrow-vision`, `burrow-db`) next to the other stacks on the shared VPS,
behind the one Caddy that owns ports 80 and 443. Images are built in GitHub Actions and pulled on the box, never built
there. The decisions behind this shape are in [ADR-0005](../adr/0005-deployment-shape.md) (one instance, readiness-gated
rollout) and [ADR-0006](../adr/0006-local-store-encrypted-offsite-backup.md) (the VPS disk is the store of record, with an
encrypted nightly backup on Azure).

| File                                                                                                                                     | Purpose                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [`vps/deploy.sh`](vps/deploy.sh)                                                                                                         | Forced-command deploy: one validated tag in, readiness-gated rollout or rollback out |
| [`vps/Caddyfile.snippet`](vps/Caddyfile.snippet)                                                                                         | The vhost to add to the shared Caddyfile                                             |
| [`vps/backup.sh`](vps/backup.sh), [`burrow-backup.service`](vps/burrow-backup.service), [`burrow-backup.timer`](vps/burrow-backup.timer) | Nightly encrypted database dump and blob copy                                        |
| [`vps/restore-drill.sh`](vps/restore-drill.sh)                                                                                           | Proves a backup restores, on a scratch machine                                       |
| [`../../docker-compose.prod.yml`](../../docker-compose.prod.yml)                                                                         | The production stack                                                                 |

## Status of the one-time setup (2026-10-24)

| Step                                                                      | State                                                                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub OAuth app                                                          | Registered; callbacks for production and `localhost:8080`; id and secret in the VPS `.env`                                            |
| Microsoft app registration                                                | Registered (personal and work accounts, token version 2); 2-year secret in the VPS `.env`, **expires 2028-10-24, rotate before then** |
| Google OAuth client                                                       | Created (project `burrow-512617`, External, testing mode with the owner as test user); id and secret in the VPS `.env`                |
| Azure backup account                                                      | Created (`burrow-rg`, private Cool-tier container, soft delete and versioning, lifecycle rule)                                        |
| `/opt/burrow`, `.env` (mode 600), compose file, deploy and backup scripts | In place on the VPS                                                                                                                   |
| Forced-command CI key                                                     | Installed; refuses any command that is not a release tag (tested)                                                                     |
| GitHub `VPS_SSH_KEY` secret and `VPS_HOST` variable                       | Set                                                                                                                                   |
| metrion key and collector route                                           | Done ([metrion-onboarding.md](metrion-onboarding.md))                                                                                 |
| Backup credentials on the VPS, `rclone`, GPG key                          | See "Backups" below                                                                                                                   |
| Caddy vhost, DNS record, first release                                    | Go-live, see "Releasing"                                                                                                              |

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
   GITHUB_CLIENT_ID=...    GITHUB_CLIENT_SECRET=...
   MICROSOFT_CLIENT_ID=... MICROSOFT_CLIENT_SECRET=...
   GOOGLE_CLIENT_ID=...    GOOGLE_CLIENT_SECRET=...      # optional until the Google client exists
   ENV
   ```

   Then add [`vps/Caddyfile.snippet`](vps/Caddyfile.snippet) to `/opt/portfolio/Caddyfile` and reload Caddy with the
   shared `/opt/caddy-reload.sh` (never `docker exec caddy reload`; the script exists because a bind mount of a single
   file follows the inode, not the path).

5. **Metrics**: see [metrion-onboarding.md](metrion-onboarding.md).

## Faster uploads and import from a link

**Why uploads were slow.** Measured against the real server on a home line, 8 pieces of 16 MB in parallel: HTTP/3
11.0 Mbit/s, HTTP/2 12.2, HTTP/1.1 22.3. A browser sends every request to one origin over a single HTTP/2 or HTTP/3
connection, and one connection carries about half of that line; HTTP/1.1 opens up to six. So the server can announce a
second origin that serves HTTP/1.1 only, and the page sends the upload pieces there.

`UPLOAD_ORIGIN` in `/opt/burrow/.env` announces it (empty = off; the page then uses its own origin). The page probes
`<origin>/livez` first and falls back to its own origin if that fails, or if a piece cannot reach it, so a blocked port only
costs the speed-up. On the VPS, with a backup of each file first:

1. `/opt/portfolio/Caddyfile`: add the block from `vps/Caddyfile.snippet` (the `:8443` site) and, in the global options at
   the top, `servers :8443 { protocols h1 }`.
2. `/opt/portfolio/docker-compose.prod.yaml`: publish `8443:8443` on the caddy service, and `sudo ufw allow 8443/tcp`.
3. Load Caddy through `/opt/caddy-reload.sh` (it validates first), recreate caddy for the new port, then set
   `UPLOAD_ORIGIN=https://burrow.woofi-developments.at:8443` in `/opt/burrow/.env` and recreate burrow.

The :8443 site only forwards `/livez` and the upload pieces (`/api/uploads/<id>/chunks/<n>`); everything else there is a 404.

**Import from a link.** `POST /api/imports` makes the server download a link, so the speed of the person's own line does
not matter. `IMPORT_ENABLED=false` switches it off, `IMPORT_MAX_GB` (default 10) caps one file, `IMPORT_MAX_PER_USER`
(default 2) caps parallel downloads per account. Never set `IMPORT_ALLOW_PRIVATE=true` in production: it lets a link point
at this machine and exists only for tests.

## The assistant's language model

The chat page talks to `burrow-llm`: llama.cpp serving a 4-bit Qwen2.5 3B Instruct (about 2.1 GB on disk, 2.3 GiB
resident, 12 tokens a second on three EPYC cores, measured). It joins only the internal `llm-net`, so it can reach
neither the internet nor the database. The model file is not part of any image; put it on the box once:

```bash
sudo install -d -o deploy -g deploy /opt/burrow/models
curl -L -o /opt/burrow/models/qwen2.5-3b-instruct-q4_k_m.gguf \
  https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_k_m.gguf
docker compose -f docker-compose.prod.yml --env-file .env up -d burrow-llm
```

Why 3B and not 1.5B: the 1.5B model wrote its actions into the reply text and then repeated itself until it hit the
token limit; the 3B model followed the answer format in every test. Answers are cut at 450 tokens and one runs at a
time (`LLM_CONCURRENCY`), the rest wait and the page says how many are ahead. Without the model file, or with
`LLM_SERVICE_URL` unset, the chat page says the assistant is not running and nothing else is affected.

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

A published GitHub Release runs `.github/workflows/release.yml`. Each part is its own job and is only rebuilt when
its files changed:

| Job               | What                                                                                                       | When it builds                                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan              | Hashes the sources of each component and checks which images already exist                                 | always, and prints a table in the run summary                                                                                                                    |
| Web image         | `apps/api` and `apps/frontend` in one image, tagged `web-<hash of its sources>`                            | only when that tag does not exist yet, i.e. only when its files changed                                                                                          |
| AI detector image | `apps/vision`, tagged `vision-<hash>`                                                                      | only when asked: put `[vision]` in the release notes, or run the workflow by hand with "vision" ticked. Otherwise the vision image on the server stays untouched |
| Deploy            | Sends `deploy api=<tag> vision=<tag or keep> version=<release> revision=<sha>` over the forced-command key | after you approve the `production` environment                                                                                                                   |
| Tidy the registry | Deletes old and duplicate image versions                                                                   | after a successful deploy                                                                                                                                        |

`deploy.sh` rewrites `API_TAG`, `VISION_TAG`, `APP_VERSION` and `APP_REVISION` in `.env`, pulls, restarts, and waits for
`/readyz` to answer three times in a row. If it never does, it restores the previous tags and exits non-zero, so the
workflow fails loudly and the old version keeps serving. `deploy.sh status` prints the tags that are deployed now.

Rolling back by hand: run the release workflow again with the older release tag (`workflow_dispatch`); a missing image is
rebuilt from that tag's sources.

The registry keeps the deployed tags and the newest three images of each kind (`organizational/deploy/registry-tidy.sh`,
also runnable on its own as the "Registry tidy" workflow).

The first start applies the schema (`scripts/run-migrations.mjs` runs before the server). Take a backup first whenever a
release contains a new migration.

## Accounts

Registration is open to everyone and every account is equal: there is no owner and no setup step. Anyone can sign in
with GitHub, Microsoft or Google (that creates the account) or choose "New here? Create an account" and register with
a username and a password of 12 or more characters. Link further providers from the Profile page. Nothing is reachable
without signing in. An old `REGISTRATION_OPEN` line in `/opt/burrow/.env` is ignored and can be deleted.

## Restoring

1. On a scratch machine run `vps/restore-drill.sh <object>` and check the row counts against production.
2. For a real restore, stop the stack, `pg_restore --clean --if-exists --no-owner` the decrypted dump into `burrow-db`,
   `rclone copy blobs: /opt/burrow/data/blobs`, then start the stack again. The recovery point is the last nightly run.

## Verified before shipping

The compose file validates (`docker compose config`, on the VPS too), the dump of the real schema restores into a clean
Postgres with ltree paths and pgvector embeddings intact (row counts compared), and the smoke suite in `e2e/` passes
against the built images, both locally and in CI. The deploy key was shown to refuse any command that is not a release
tag. Verified at go-live and not before: the Caddy vhost, the DNS record, and the encrypted Azure path end to end.
