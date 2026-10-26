# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/) once a
first release is cut.

## [Unreleased]

## [0.2.0] - 2026-10-26

### Added

- Share links to a file or a whole category: open to anyone with the link, or only to the accounts you add; permanent or expiring (1 hour to 30 days), revocable, editable. A "Shared" page lists links you made and what was shared with you, and `/s/<token>` is the public viewing page.
- Upload a `.zip`: its files are unpacked and stored one by one (folders, hidden files and macOS resource forks are skipped, entry count and unpacked size are bounded).
- Bulk upload runs three files at a time and waits out a rate limit instead of failing.
- "Sort all now" on the Unsorted view.

### Fixed

- Sorting never worked in production: the API did not send the vision service's token, so every classification was refused with 401.
- "Sort now" processes the whole backlog instead of one batch of 100, and reports what is still waiting.
- "Too many uploads": the upload limit is 3000 per 15 minutes and the general API limit 3000; thumbnails and downloads no longer count against it.

### Changed

- The whole interface is redesigned: neutral surfaces, hairline borders instead of shadows, small radii, Geist type and one terracotta accent, in light and dark.

## [0.1.7] - 2026-10-26

### Changed

- The owner setup token is gone: the first account is created by password or by signing in with GitHub, Microsoft or Google.
- Sign-in form and provider buttons restyled: flat, bordered, no glows.

## [0.1.6] - 2026-10-26

### Changed

- Bottom bar now matches the other apps: copyright, build chip, Status, Impressum, Privacy Policy and Contact.
- Google sign-in is configured on the live site.

## [0.1.5] - 2026-10-25

### Changed

- Sign-in page always fits the screen, at any size.
- The colour panel is removed everywhere; a light and dark mode toggle replaces it (sidebar and sign-in page), following the system setting until chosen.
- GitHub, Microsoft and Google icons are always shown; a provider that is not set up yet is dimmed.
- Bottom bar on every page with copyright, the legal pages and the running version.

## [0.1.3] - 2026-10-25

### Changed

- Sign-in illustration redrawn: carved tunnels and rooms, works in light and dark.
- Secondary text keeps at least AA contrast on the light palette; first-visit contrast is medium.
- Clickable prototype in `prototypes/` that reuses the real screens with example data.

## [0.1.2] - 2026-10-25

### Changed

- Sign-in page redesigned: burrow cross-section illustration, GitHub, Microsoft and Google as icon buttons with tooltips instead of text.
- Neutral example room names in the illustration.

## [0.1.1] - 2026-10-25

- The first account now needs a setup token (`OWNER_SETUP_TOKEN`), and a provider login cannot create it: a new
  public hostname must not let a stranger become the owner. The sign-up page shows the field when it is needed.

## [0.1.0] - 2026-10-25

- Built `apps/api`: credential and OIDC login, revocable sessions, the ltree category tree with atomic subtree
  moves, content-addressed uploads with dedup, ranked name search, the review queue and the scheduler.
- Built `apps/vision`: OpenCLIP ViT-B/32 embeddings and zero-shot scoring plus a dedicated NSFW classifier on
  ONNX Runtime; measured latency and memory are recorded in ADR-0004.
- Built `apps/frontend`: drive, search, review, profile and the colour panel.
- Uploads live on the VPS disk with an encrypted nightly backup to Azure Blob Storage (ADR-0006), instead of Backblaze.
- Completed the Impressum, privacy policy and terms and serve them in the app at `/impressum`, `/privacy` and `/terms`.
- Added the production compose file, the forced-command deploy script, the Caddy vhost, the nightly backup
  timer and the restore drill, the release workflow, and an end-to-end smoke test.

- Scaffolded the repository: npm workspaces, tooling config, directory
  layout for `apps/api`, `apps/vision`, `apps/frontend`, `prototype`,
  `packages/shared`, and `organizational/`. No application code yet.
