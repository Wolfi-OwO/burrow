# Contributing to burrow

burrow is a personal, single-tenant project — there's one contributor today.
This file exists so the ground rules are written down before that changes,
and so the tooling has something to enforce.

## Getting set up

Setup instructions live per-component, since the repo is split into three
independent pieces (API server, vision server, frontend) plus a shared
package:

- `apps/api/README.md` — main API server (Node.js/TypeScript)
- `apps/vision/README.md` — AI-classification server (Python/FastAPI)
- `apps/frontend/README.md` — frontend (React/Vite/TypeScript)
- `packages/shared/README.md` — types and schemas shared by API and frontend

None of these exist yet beyond a placeholder README — check
`organizational/requirements/` for what's currently in scope.

## Ground rules

- **No secrets, no user files, no model weights in git. Ever.** See
  `.gitignore` — `.env`, `blobs/`, `*.onnx`, `*.pt` are all excluded on
  purpose; don't force-add around it.
- **Explicit names, no abbreviations** — `authenticationService`, not
  `authSvc`.
- **The vision service holds no user data.** It receives a file, returns a
  category prediction, keeps nothing. Do not add persistence to
  `apps/vision` without an ADR justifying the exception — see
  `organizational/adr/`.
- **Tests accompany behaviour.** New logic ships with a runnable check.

## Commit messages

Past tense, short, plain English. No `type(scope):` prefix — not `feat(api):
add upload endpoint`, just `added the upload endpoint`.

No AI attribution of any kind in a commit message: no `Co-Authored-By:`
naming an assistant, no "Generated with ..." line, no `Assisted-by:`,
`Generated-by:`, or `Written-by:` trailer. A `Co-Authored-By:` naming a real
human is fine — that one carries real information.

## Versioning and releases

burrow follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.
While the major version is `0`, treat `MINOR` as the breaking-change slot and
`PATCH` as the safe one:

- **PATCH**: bug fixes, dependency bumps, docs, anything that doesn't
  change behaviour a caller could depend on.
- **MINOR**: new features, additive surface, anything that could still
  break a caller relying on undocumented behaviour.
- **MAJOR**: reserved for `1.0.0` once the API is considered stable.

Add a one-line entry to `CHANGELOG.md` under `## [Unreleased]` with each
change that affects behaviour. There is no CI, no remote, and no release
process yet — this section is here for when there is.

By contributing you agree that your contributions are covered by this
project's license terms once one is chosen (see `README.md#legal`).

## Branch protection

`main` is protected: no force-pushes, no deletions, and every change lands
through a pull request that must pass both required checks —
**Repository hygiene** (markdownlint + the AI-attribution guard) and
**Secret scan (gitleaks)** — before it can merge. `required_approving_review_count`
is `0` since this is a single-maintainer repo; the gate is CI, not a second
human. `enforce_admins` is `false` so the one maintainer can still push an
emergency fix directly to `main` if a check itself is broken — that's an
escape hatch for incidents, not the normal path.
