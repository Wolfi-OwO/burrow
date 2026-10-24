# v0.1.0 release checklist

Work top to bottom; a box is ticked when the command was run and its output looked right, not when it was
intended. Items marked **operator** need an account or a secret that the repository must never hold.

## Before tagging

- [ ] `npm ci && npm run lint && npm run typecheck` is clean at the repository root.
- [ ] `npm test -w apps/api` passes against a real Postgres (CI runs it with the pgvector image).
- [ ] `python -m pytest` in `apps/vision` passes after `python scripts/export_models.py`.
- [ ] `node --test e2e/smoke.test.mjs` passes against `docker compose up --build` (CI runs it too).
- [ ] CI on `main` is green, including the Security workflow (gitleaks, Trivy, CodeQL).
- [ ] `gitleaks detect --no-git --source .` reports nothing, and a hand sweep of the tree finds no addresses,
      coordinates, SSIDs or place names (this repository is public).
- [ ] `docker compose -f docker-compose.prod.yml --env-file <a real .env> config -q` is silent.
- [ ] `CHANGELOG.md` has the release entry; version numbers in `package.json` files match the tag.

## Blockers only the operator can clear

- [x] The legal documents are complete: `grep -n TODO IMPRESSUM.md PRIVACY.md TERMS_OF_USE.md` prints nothing, and
      the app serves them at `/impressum`, `/privacy` and `/terms` (issue #59).
- [ ] **operator** Re-check the Data Privacy Framework status of GitHub, Microsoft and Google
      (<https://www.dataprivacyframework.gov/list>), and update the dated line in `PRIVACY.md` § 5.
- [ ] **operator** Confirm the Contabo data processing agreement is accepted in the Contabo customer account
      (`PRIVACY.md` § 5). The Azure backup holds encrypted data only; Microsoft's standard online services terms
      apply to the account you already have.
- [ ] **operator** Have a Rechtsanwalt look at `IMPRESSUM.md` (street address question) and at the age-verification
      finding in `WEB_APP_COMPLIANCE_CHECKLIST.md`; get Contabo's position on private NSFW storage in writing, or
      plan the fallback host that checklist describes.
- [x] The offsite backup target exists (`burrow-rg`, private Cool container, soft delete, lifecycle) and the VPS has
      `rclone`, the public GPG key and `backup.env` (ADR-0006); `deploy/README.md`, "Backups".
- [ ] **operator** Google sign-in: in the Google Cloud console, project `burrow-512617`, open Google Auth Platform,
      create the branding (app name `burrow`, your support and contact email, audience External), add yourself as a
      test user, then create an OAuth client of type Web application with the redirect URIs
      `https://burrow.woofi-developments.at/api/auth/google/callback` and
      `http://localhost:8080/api/auth/google/callback`. Put the client id and secret into `/opt/burrow/.env` as
      `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Until then Google is simply not offered on the login page.
- [ ] **operator** The DNS record exists and `dig +short burrow.woofi-developments.at` answers.
- [ ] **operator** Repository variables and secrets for the release workflow are set (`deploy/README.md`, step 3).
- [ ] **operator** The VPS stack directory, `.env`, Caddy vhost, forced-command key and backup timer are in place.
- [ ] **operator** The NSFW classifier was evaluated on a labelled sample of real content (ADR-0004); the sample is
      never committed.

## Release

- [ ] Publish the GitHub Release `v0.1.0`; the release workflow builds, pushes and deploys.
- [ ] `curl -fsS https://burrow.woofi-developments.at/readyz` answers 200 and `/api/version` shows `v0.1.0`.
- [ ] Create the owner account in the browser; confirm registration is then closed (`POST /api/auth/register`
      returns 403 for a second account).
- [ ] Upload a photo, press "Sort now" on the Review page, see it filed or queued.
- [ ] `sudo systemctl start burrow-backup.service` finishes, and `restore-drill.sh` restores the new dump.
- [ ] The three containers appear in metrion (`deploy/metrion-onboarding.md`).

## After

- [ ] Close the issues the release implements, with the commit that did it.
- [ ] Rotate nothing that was not exposed; record the release in `CHANGELOG.md` and move on.
