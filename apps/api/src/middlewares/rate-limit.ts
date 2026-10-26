import { rateLimit } from 'express-rate-limit';
import { config } from '../config/index.ts';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * Caps login attempts per IP. Flagged by CodeQL as missing on `POST
 * /auth/login`: without it, a client can brute-force a password at network
 * speed since `authenticateUser`'s argon2 check, while slow, is not slow
 * enough to make that infeasible on its own.
 */
export const loginRateLimiter = rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: config.loginRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'TooManyRequestsError',
        message: 'Too many login attempts.',
        statusCode: 429,
    },
});

const API_WINDOW_MS = 15 * 60 * 1000;

/**
 * A generous, app-wide cap per IP, mounted once ahead of every API route so no route needs its own copy.
 * `skip` exempts anything that is not an API call (static assets, the SPA shell): without it a handful of
 * page loads would spend the same budget as real API traffic and 429 the app off its own page.
 */
export const apiRateLimiter = rateLimit({
    windowMs: API_WINDOW_MS,
    limit: config.apiRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    // Only API calls count; static assets and SPA page loads must not eat the budget. Thumbnails and downloads are
    // one request per image, so a grid of 200 files would otherwise spend the whole window on pictures.
    skip: (req) => {
        const path = req.path.toLowerCase();
        return (
            !path.startsWith('/api/') ||
            /\/(thumbnail|content|avatar)$/.test(path) ||
            /\/chunks\/\d+$/.test(path)
        );
    },
    message: {
        error: 'TooManyRequestsError',
        message: 'Too many requests.',
        statusCode: 429,
    },
});

const METRICS_WINDOW_MS = 60 * 1000;

/**
 * A dedicated, tight cap on `GET /metrics`. That route is mounted ahead of
 * `apiRateLimiter` above (app.ts), same as `healthRouter` — but unlike a
 * liveness probe, `/metrics` does real work (`registry.metrics()`) and is a
 * guessable-token target (see routes/metrics.routes.ts), so leaving it fully
 * unlimited turns every incorrect guess into a free, unauthenticated way to
 * flood the error path. 30/min comfortably covers a real Prometheus scrape
 * interval (typically 15-60s) while bounding a brute-force attempt.
 */
export const metricsRateLimiter = rateLimit({
    windowMs: METRICS_WINDOW_MS,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        error: 'TooManyRequestsError',
        message: 'Too many metrics requests.',
        statusCode: 429,
    },
});

const UPLOAD_WINDOW_MS = 15 * 60 * 1000;

/** Caps uploads per IP (FR-017's size cap bounds one upload; this bounds how many). */
export const uploadRateLimiter = rateLimit({
    windowMs: UPLOAD_WINDOW_MS,
    limit: config.uploadRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'TooManyRequestsError', message: 'Too many uploads.', statusCode: 429 },
});
