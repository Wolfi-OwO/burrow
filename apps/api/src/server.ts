import { existsSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import type { CorsOptions } from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { config, validateConfig } from './config/index.ts';
import { getPool } from './database/connection.ts';
import { correlationId, logger } from './lib/logger.ts';
import { httpRequestDuration } from './lib/metrics.ts';
import { errorHandler, notFound } from './middlewares/error-handler.ts';
import { apiRateLimiter } from './middlewares/rate-limit.ts';
import { authRouter } from './routes/auth.routes.ts';
import { categoryRouter } from './routes/category.routes.ts';
import { fileRouter } from './routes/file.routes.ts';
import { healthRouter } from './routes/health.routes.ts';
import { metricsRouter } from './routes/metrics.routes.ts';
import { profileRouter } from './routes/profile.routes.ts';
import { publicShareRouter, shareRouter } from './routes/share.routes.ts';
import { versionRouter } from './routes/version.routes.ts';
import { schedulerService } from './services/scheduler-service.ts';

/**
 * The one startup file: it configures the app at module scope and only listens when run directly, so a test
 * can `import { app }` without opening a port or a database connection.
 */
export const app = express();

// Caddy terminates TLS and forwards plain HTTP with X-Forwarded-*; `1` trusts exactly that hop. Without it
// req.protocol is always http (breaking the OAuth redirect_uri) and every client shares Caddy's rate-limit key.
app.set('trust proxy', 1);

app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                ...helmet.contentSecurityPolicy.getDefaultDirectives(),
                // Thumbnails and previews come from this origin only; nothing is framed by anyone.
                'img-src': ["'self'", 'data:', 'blob:'],
                'frame-ancestors': ["'none'"],
            },
        },
        strictTransportSecurity: { maxAge: 63_072_000, includeSubDomains: true },
    }),
);

const corsOptions: CorsOptions = {
    // Same-origin browsers and non-browser callers send no Origin; only a browser that sent one is constrained.
    origin: (origin, callback) =>
        callback(null, origin === undefined || config.corsAllowedOrigins.includes(origin)),
    preflightContinue: true,
};
app.use(cors(corsOptions));
app.use(pinoHttp({ logger, genReqId: (req) => correlationId(req.headers) }));
app.use(express.json({ limit: '100kb' }));

// Latency per matched route pattern (not raw path), so /files/<a> and /files/<b> are one series.
app.use((req, res, next) => {
    const stop = httpRequestDuration.startTimer();
    res.on('finish', () => {
        const route = req.route as { path?: string } | undefined;
        stop({ method: req.method, route: route?.path ?? req.path, status_code: res.statusCode });
    });
    next();
});
app.use(metricsRouter);
app.use(healthRouter);
app.use(apiRateLimiter);

app.use(versionRouter);
app.use('/api/auth', authRouter);
app.use('/api/categories', categoryRouter);
app.use('/api', publicShareRouter);
app.use('/api', shareRouter);
app.use('/api', profileRouter);
app.use('/api', fileRouter);

// The built frontend, when present (the Dockerfile copies it to ../public). Mounted after every API router:
// it falls back to index.html for anything not matched above, so a client route that shares a literal path
// with an API route would be unreachable by a hard reload.
const frontendDist = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const API_PREFIXES = ['/api', '/health', '/livez', '/readyz', '/metrics'];
if (existsSync(frontendDist)) {
    app.use(express.static(frontendDist, { index: false }));
    app.get(/.*/, (req, res, next) => {
        // A path with a file extension is an asset, not a client route: a missing one must be a 404, not an HTML
        // page that a stale cache would then try to run as a script.
        if (
            extname(req.path) !== '' ||
            API_PREFIXES.some((prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`))
        ) {
            next();
            return;
        }
        res.sendFile(join(frontendDist, 'index.html'));
    });
}

app.use(notFound);
app.use(errorHandler);

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
    validateConfig();
    const server = app.listen(config.port, () => {
        logger.info({ port: config.port }, 'apps/api listening');
    });
    const stopScheduler = schedulerService.start();

    const shutdown = (signal: string): void => {
        logger.info({ signal }, 'shutting down');
        stopScheduler();
        server.close(() => {
            getPool()
                .shutdown()
                .then(
                    () => process.exit(0),
                    () => process.exit(1),
                );
        });
        // A hung connection must not block a deploy forever.
        setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}
