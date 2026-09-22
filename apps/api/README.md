# apps/api

The main application server: Node.js/TypeScript, Express 4, PostgreSQL 16
(via `ltree` for the category tree and `pgvector` for embeddings). Owns
users, auth (credentials + GitHub/Microsoft/Google OIDC), profiles, the
user-editable category tree, file metadata, and the schedule that calls
`apps/vision` for bulk sorting. Nothing lives here yet — no code, no
`package.json` — this directory exists so the workspace layout is ready to
receive it.
