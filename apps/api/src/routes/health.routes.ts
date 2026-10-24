import { Router } from 'express';

import { getPool } from '../database/connection.ts';

/**
 * `/health` (unchanged — the Dockerfile HEALTHCHECK still targets it) plus
 * `/livez`/`/readyz`, the canonical paths shared with the other apps behind
 * the same Caddy edge (portfolio, netviz, preussen-web), so one deploy
 * mechanism can probe the same two paths everywhere instead of a different
 * one per app. The distinction is the point: `/livez` answers unconditionally
 * (the process didn't wedge — worth a restart if it ever fails) while
 * `/readyz` runs a real round-trip query through `getPool().isReachable()`
 * (the app can actually serve — worth gating a traffic switch on, never a
 * restart). No dependencies for liveness, so no factory needed.
 */
export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});

healthRouter.get('/livez', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});

healthRouter.get('/readyz', (_req, res) => {
    // getPool() itself throws synchronously if DATABASE_URL is unset (see
    // its own comment) — caught here too, not just at startup's
    // validateConfig(), so a misconfigured process reports "not ready"
    // instead of crashing this one route.
    try {
        getPool()
            .isReachable()
            .then((reachable) => {
                res.status(reachable ? 200 : 503).json({
                    status: reachable ? 'ok' : 'unreachable',
                });
            })
            .catch(() => {
                res.status(503).json({ status: 'unreachable' });
            });
    } catch {
        res.status(503).json({ status: 'unreachable' });
    }
});
