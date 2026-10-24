# apps/frontend

The web client: React 19, Vite, TypeScript, TanStack Query and React Router. It talks to `apps/api` under `/api`
on the same origin (the Vite dev server proxies it), keeps the access token in memory only, and renews it from the
HttpOnly refresh cookie. Visual direction: soft tactile, with warm tokens that the vendored colour panel
(`public/appearance.js`, copied unchanged from the reference implementation) can swap at runtime.

```bash
npm run dev -w apps/frontend    # http://localhost:5173, needs apps/api on :8080
npm run build -w apps/frontend  # dist/, which the API image serves
```
