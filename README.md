<div align="center">

# burrow

A private, self-hosted file drive — like Google Drive, but single-tenant and
mine. I upload anything, and a scheduled AI job sorts it into a category tree
I define myself (`Furry/SFW/WOLF`, `Furry/NSFW`, `Nature`, ...), instead of
filing it by hand. It runs: the API, the web client and the vision service
are built and tested end to end, with real model inference. What is not done
is the deployment (it needs my Backblaze, DNS and registry credentials) and
the legal documents (they need my address and decisions only I can make) — see
[the release checklist](organizational/release-checklist.md).

## Features

- Sign in with a password (Argon2id) or GitHub, Microsoft or Google, with revocable sessions
- A category tree of any depth, drag and drop, atomic subtree moves (Postgres `ltree`)
- Upload with content-addressed storage: the same bytes are stored once
- Name search, ranked, with each hit's place in the tree
- AI sorting: OpenCLIP zero-shot against my own category names, a dedicated NSFW model, a confidence
  threshold, and a review queue for what it is unsure of
- Thumbnails, a profile, a colour panel with palettes and fine-tuning

![CI](https://img.shields.io/badge/CI-not_set_up_yet-lightgrey)
![Security](https://img.shields.io/badge/security_scan-not_set_up_yet-lightgrey)
![License](https://img.shields.io/badge/license-private-lightgrey)

![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/Node-%E2%89%A522-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![pgvector](https://img.shields.io/badge/pgvector-embeddings-4169E1?logo=postgresql&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)
![ONNX Runtime](https://img.shields.io/badge/ONNX_Runtime-inference-000000?logo=onnx&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-per_service-2496ED?logo=docker&logoColor=white)

</div>

## Why it is built this way

burrow is split into two independently deployable services, the same way
nutrilens is (see nutrilens's ADR-0001, and this project's own ADR once
it's written under `organizational/adr/`):

- **`apps/api`** — the primary application server (Node.js/TypeScript,
  Express, PostgreSQL). Owns users, auth, profiles, the category tree, and
  file metadata.
- **`apps/vision`** — a standalone AI-classification service (Python/
  FastAPI, ONNX Runtime). Owns nothing but inference: it receives a file,
  returns a category prediction, and holds no user data — no database, no
  persisted files, no logs containing file content.

Beyond the isolation argument (a vulnerability or a bad dependency in the
inference stack shouldn't have a path to user data or database
credentials), there's a harder constraint specific to this app: the vision
model has to be self-hosted. burrow exists partly to sort NSFW content into
its own branch of the category tree, and every mainstream cloud vision
API's terms of service forbid classifying that kind of content — there is
no cloud option here, only a model running under my own roof.

## Tech stack

| Component | Stack |
| - | - |
| Frontend | React 19, Vite, TypeScript |
| API server | Node.js, TypeScript, Express 4, PostgreSQL 16, zod |
| Vision server | Python, FastAPI, ONNX Runtime (self-hosted OpenCLIP-based model) |
| Database | PostgreSQL 16 — `ltree` for the category tree, `pgvector` for embeddings |
| Infra | Docker per service |

## Getting started

```bash
cp .env.example .env      # set JWT_SECRET (openssl rand -base64 48)
docker compose up --build
```

then open <http://localhost:8080> and create the owner account. The first build of
`apps/vision` exports the ONNX models (a few minutes, once). The first account becomes
the admin; registration stays closed afterwards.

Without Docker, per app:

```bash
npm ci
npm run database:migrate -w apps/api     # needs DATABASE_URL, see .env.example
npm test -w apps/api                     # real Postgres with pgvector required
npm run dev -w apps/api                  # :8080
npm run dev -w apps/frontend             # :5173, proxies /api to :8080
cd apps/vision && pip install -r requirements-export.txt && python scripts/export_models.py
pip install -r requirements-dev.txt && python -m pytest
node --test e2e/smoke.test.mjs           # against a running stack, BASE_URL=http://localhost:8080
```

## Project structure

```text
apps/api/                     Main application server (Node.js/TypeScript, Express, Postgres)
apps/vision/                  Isolated AI service (Python/FastAPI, ONNX Runtime), no database, keeps nothing
apps/frontend/                Web client (React, Vite, TypeScript)
e2e/                          End-to-end smoke test against a running stack
prototype/                    The early walkthrough plan; the real client replaced it
packages/shared/              Reserved for types shared between api and client; unused so far
organizational/adr/           Architecture decision records (ADR-0001 to 0005)
organizational/requirements/  Functional requirements, FR-001 onwards
organizational/deploy/        VPS runbook, deploy and backup scripts, B2 security design
docs/, scripts/, todo/        General docs, repo maintenance, scratch notes
```

## Security

- Passwords are hashed with Argon2id; a wrong password and an unknown user get the same answer.
- The access token (10 minutes) lives only in memory; the refresh token is an HttpOnly, SameSite=Strict cookie
  that rotates on every use, and logout revokes the session row, so a stolen token dies at once.
- Every file route checks ownership, and another user's id is a 404, not a 403.
- Served files carry `nosniff` and a sandboxing CSP, so an uploaded HTML or SVG file cannot run as part of the site.
- The vision service has no database, no internet route and keeps no upload; secrets live in `.env`, never in git.
- gitleaks, Trivy and CodeQL run in CI. Report a vulnerability as described in [SECURITY.md](SECURITY.md).

## Documentation

- [CONTRIBUTING.md](CONTRIBUTING.md) — ground rules and commit-message
  convention. Single-contributor project for now — no PR workflow or CI to
  gate on yet
- **Legal** — burrow is personal, single-tenant software: I am the only
  user, running it on my own infrastructure. No public license has been
  chosen yet and none is needed while nothing is published; this entry will
  state the terms before any code here is shared or self-hosted by anyone
  else. Because a stated goal of this app is sorting NSFW content, that
  content is mine, stored on infrastructure I control, and never processed
  by a third-party service — see
  [Why it is built this way](#why-it-is-built-this-way)

## License

Private — all rights reserved for now. No `LICENSE` file exists yet because
nothing here is published; this section will be updated if and when that
changes.
