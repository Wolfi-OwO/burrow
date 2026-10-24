import { timingSafeEqual } from 'node:crypto';

import { Router } from 'express';

import { config } from '../config/index.ts';
import { asyncHandler, UnauthorizedError } from '../lib/errors.ts';
import { registry } from '../lib/metrics.ts';
import { metricsRateLimiter } from '../middlewares/rate-limit.ts';

const BEARER_PREFIX = 'Bearer ';

/**
 * Constant-time string equality. A plain `!==` leaks the token character by
 * character via response-time differences — an attacker measures which
 * prefix takes marginally longer to reject and rebuilds the token one byte
 * at a time. `timingSafeEqual` throws on a length mismatch instead of
 * comparing, so the length check must happen first — and happen without
 * itself branching on the *values*, only their lengths, which is not secret.
 */
function timingSafeStringEqual(a: string, b: string): boolean {
    const bufferA = Buffer.from(a);
    const bufferB = Buffer.from(b);
    return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

/**
 * `GET /metrics` — Prometheus scrape endpoint.
 *
 * Access-restricted by an optional shared token, checked when set, a no-op when it isn't (local dev, CI). A
 * Prometheus scraper has no user session to present, so this can't reuse
 * `requireAuth` — a static bearer token is the equivalent defense here, and
 * a standard `Authorization: Bearer` (not a custom header) is what
 * Prometheus's own `authorization:` scrape-config block sends natively —
 * see organizational/deploy/prometheus-scrape-config.yml. `validateConfig()`
 * (config/index.ts) requires the token be set in production, so "optional"
 * only applies to local dev/CI.
 */
export const metricsRouter = Router();

metricsRouter.get(
    '/metrics',
    metricsRateLimiter,
    asyncHandler(async (req, res) => {
        if (config.metricsToken) {
            const header = req.header('authorization');
            const token = header?.startsWith(BEARER_PREFIX)
                ? header.slice(BEARER_PREFIX.length)
                : undefined;
            if (!token || !timingSafeStringEqual(token, config.metricsToken)) {
                throw new UnauthorizedError('Missing or invalid metrics token.');
            }
        }
        const body = await registry.metrics();
        res.set('Content-Type', registry.contentType);
        res.status(200).send(body);
    }),
);
