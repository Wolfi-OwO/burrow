# apps/api

The main application server: Node.js 24 (TypeScript run natively, built with `tsc`), Express 4, PostgreSQL 16 with
`ltree` and `pgvector`. It owns users, sessions, the category tree and file metadata, stores content in a
content-addressed blob store (the local directory is the store of record; an optional S3-compatible second copy), and runs the scheduler that calls
`apps/vision`. Layer-first layout: `models/`, `repository/`, `services/`, `handlers/`, `routes/`, `middlewares/`.

```bash
npm run database:migrate -w apps/api   # DATABASE_URL required
npm run dev -w apps/api                # http://localhost:8080
npm test -w apps/api                   # needs a Postgres with pgvector; see .env.test
```

`src/server.ts` is the only startup file; it listens only when run directly, so tests import `app` without a port.
Configuration is read in `src/config/index.ts` and nowhere else. HTTP routes live under `/api`, plus `/health`,
`/livez`, `/readyz` and `/metrics`.
