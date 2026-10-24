# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/) once a
first release is cut.

## [Unreleased]

- Built `apps/api`: credential and OIDC login, revocable sessions, the ltree category tree with atomic subtree
  moves, content-addressed uploads with dedup, ranked name search, the review queue and the scheduler.
- Built `apps/vision`: OpenCLIP ViT-B/32 embeddings and zero-shot scoring plus a dedicated NSFW classifier on
  ONNX Runtime; measured latency and memory are recorded in ADR-0004.
- Built `apps/frontend`: drive, search, review, profile and the colour panel.
- Added the production compose file, the forced-command deploy script, the Caddy vhost, the nightly backup
  timer and the restore drill, the release workflow, and an end-to-end smoke test.

- Scaffolded the repository: npm workspaces, tooling config, directory
  layout for `apps/api`, `apps/vision`, `apps/frontend`, `prototype`,
  `packages/shared`, and `organizational/`. No application code yet.
