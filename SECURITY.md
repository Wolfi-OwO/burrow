# Security Policy

## Scope

burrow is a private, single-tenant deployment — there is no public
instance and no bug-bounty program. This policy covers the source code in
this repository (`apps/api`, `apps/vision`, `apps/frontend`,
`packages/shared`) and its deployment tooling under `organizational/deploy`.

Out of scope: the operator's own live VPS, credentials, or any data of
actual account holders — none of that lives in this repository (see
CONTRIBUTING.md: "No secrets, no user files, no model weights in git.
Ever.").

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for a security vulnerability
in this code.

Instead, report privately via GitHub's
[private vulnerability reporting](../../security/advisories/new), or email
<koflerphillip@outlook.com> with:

- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- any suggested remediation.

**TODO** — no formal response-time SLA committed yet (this is a
single-maintainer personal project, not a team with an on-call rotation);
expect a best-effort response, not a guaranteed window, until this is
revisited.

## Automated Scanning

**TODO** — no CI/security tooling configured yet (see README.md badges:
"CI: not set up yet", "security scan: not set up yet"). This is scaffolding
only; secret scanning (gitleaks, GitHub push protection), dependency
scanning, and static analysis are expected in a later pass, not yet present.

## Handling of Sensitive Data

- **Secrets** live only in environment variables, never committed —
  enforced by `.gitignore` per CONTRIBUTING.md.
- **User files and model weights** are excluded from git by design
  (`blobs/`, `*.onnx`, `*.pt`).
- **The vision service (`apps/vision`) holds no user data** — no database,
  no persisted files, no logs containing file content, per CONTRIBUTING.md
  and README.md's architecture rationale.
- **NSFW-category content**: see `WEB_APP_COMPLIANCE_CHECKLIST.md` for the
  hosting-provider-level finding on what this VPS's terms permit — that is
  a compliance question, not a code-security one, but it's tracked here
  because it bears directly on what this deployment can safely store.
