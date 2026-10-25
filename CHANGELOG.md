# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/) once a
first release is cut.

## [Unreleased]

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
