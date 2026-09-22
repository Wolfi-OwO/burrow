<div align="center">

# burrow

A private, self-hosted file drive — like Google Drive, but single-tenant and
mine. Upload anything, and a scheduled AI job sorts it into a category tree
I define myself (`Furry/SFW/WOLF`, `Furry/NSFW`, `Nature`, ...), instead of
me filing it by hand.

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

## Why a separate vision service

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

## Status

Scaffolding only. This pass created the repository layout, npm workspaces,
and shared tooling config (ESLint, Prettier, TypeScript base config,
markdownlint, Docker Compose skeleton). Nothing is implemented: no auth, no
API, no frontend, no vision model, no database schema. `apps/api`,
`apps/vision`, `apps/frontend`, and `packages/shared` are all empty
directories with a placeholder README.

## Stack

| Component     | Stack                                                        |
| -------------- | ------------------------------------------------------------ |
| Frontend       | React 19, Vite, TypeScript                                   |
| API server     | Node.js, TypeScript, Express 4, PostgreSQL 16, zod            |
| Vision server  | Python, FastAPI, ONNX Runtime (self-hosted OpenCLIP-based model) |
| Database       | PostgreSQL 16 — `ltree` for the category tree, `pgvector` for embeddings |
| Infra          | Docker per service                                            |

## Repository layout

```text
apps/api/                    Main application server (Node.js/TypeScript) — empty scaffold
apps/vision/                 Isolated AI-classification service (Python/FastAPI) — empty scaffold
apps/frontend/                Production frontend (React/Vite/TypeScript) — empty scaffold
prototype/                   Static, hardcoded-data design walkthrough — empty scaffold
packages/shared/              Types/schemas shared between apps/api and apps/frontend — empty scaffold
organizational/adr/           Architecture decision records — empty
organizational/requirements/  Numbered requirement docs, written before the feature they describe
organizational/deploy/        Deployment docs for the self-hosted stack — empty
docs/                         General project documentation — empty
scripts/                      Repo-maintenance scripts — empty
todo/                         Scratch task notes ahead of a proper issue or requirement — empty
```

## Development

```bash
cp .env.example .env
docker compose up
```

This is the planned shape once `apps/api` and `apps/vision` have Dockerfiles
— it does not build yet. Nothing else to run locally today; there is no
application code in this pass.

## Security

No auth, no network-facing code, nothing to attack surface yet. Once
`apps/api` exists, secrets stay in `.env` (never committed — see
`.gitignore`), and vulnerability handling gets its own `SECURITY.md`.

## Legal

burrow is personal, single-tenant software — I am the only user, running it
on my own infrastructure. No public license has been chosen yet and none is
needed while nothing is published; this section will state the terms before
any code here is shared or self-hosted by anyone else. Because a stated goal
of this app is sorting NSFW content, that content is mine, stored on
infrastructure I control, and never processed by a third-party service —
see [Why a separate vision service](#why-a-separate-vision-service).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the ground rules and commit-message
convention. Single-contributor project for now — no PR workflow or CI to
gate on yet.

## License

Private — all rights reserved for now. No `LICENSE` file exists yet because
nothing here is published; this section will be updated if and when that
changes.
