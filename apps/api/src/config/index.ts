// Centralised application configuration (12-factor: read from the environment).
// The only file that reads process.env; everything else imports `config`.

import { pinVerifyFullSsl } from '../lib/database-url.ts';

const MEBIBYTE = 1024 * 1024;

export const config = {
    /** HTTP port the API listens on. */
    port: Number(process.env.PORT) || 8080,
    nodeEnv: process.env.NODE_ENV ?? 'development',
    /** pino level: trace/debug/info/warn/error/fatal/silent. */
    logLevel: process.env.LOG_LEVEL ?? 'info',
    /** Gates GET /metrics; mandatory in production (see validateConfig). */
    metricsToken: process.env.METRICS_TOKEN,
    /** PostgreSQL connection string. No default — there is no safe one. */
    databaseUrl: process.env.DATABASE_URL ? pinVerifyFullSsl(process.env.DATABASE_URL) : undefined,
    databasePoolMax: Number(process.env.DATABASE_POOL_MAX) || 20,

    /** Secret used to sign access tokens. No default. */
    jwtSecret: process.env.JWT_SECRET,
    /** Access tokens are short-lived on purpose: logout revokes the session row, and this bounds a stolen token. */
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '10m',
    /** How long a refresh token (and so a login) lives. */
    refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS) || 30,

    /** Browser origins allowed to call this API cross-origin, comma-separated. No wildcard. */
    corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),

    /**
     * When set, the very first account can only be created by presenting this token. A fresh site is reachable the
     * moment its certificate is issued, and the first account becomes the admin, so without it whoever finds the
     * hostname first owns the drive. Unset (local development) leaves the first registration open.
     */
    ownerSetupToken: process.env.OWNER_SETUP_TOKEN,

    /** Registration stays closed once the owner exists, unless this is true (burrow is single-tenant). */
    registrationOpen: (process.env.REGISTRATION_OPEN ?? 'false') === 'true',

    /** Per-IP caps (middlewares/rate-limit.ts). */
    apiRateLimitMax: Number(process.env.API_RATE_LIMIT_MAX) || 300,
    loginRateLimitMax: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 10,
    uploadRateLimitMax: Number(process.env.UPLOAD_RATE_LIMIT_MAX) || 120,

    /** FR-017: an upload larger than this is rejected before any byte is stored. */
    maxUploadBytes: (Number(process.env.MAX_UPLOAD_MB) || 200) * MEBIBYTE,
    maxAvatarBytes: 2 * MEBIBYTE,

    storage: {
        /**
         * The store of record (ADR-0006): content-addressed blobs live here, and multer stages uploads under it.
         * In production this is a bind-mounted directory that the nightly backup copies off the box.
         */
        dir: process.env.BLOB_DIR ?? './data',
        /**
         * Optional second copy of every blob on an S3-compatible store. Unset (the default) means the local
         * directory is the only live copy. Nothing in burrow requires it.
         */
        s3: {
            endpoint: process.env.S3_ENDPOINT,
            region: process.env.S3_REGION ?? 'eu-central-1',
            bucket: process.env.S3_BUCKET,
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        },
    },

    vision: {
        /** Base URL of apps/vision. Unset → the scheduler stays idle. */
        url: process.env.VISION_SERVICE_URL,
        timeoutMs: Number(process.env.VISION_TIMEOUT_MS) || 30_000,
    },

    sorting: {
        /** FR-035: below this confidence a file goes to the review queue instead of being auto-filed. */
        autoFileThreshold: Number(process.env.AUTO_FILE_THRESHOLD) || 0.6,
        /** FR-037: files scored at or above this count as NSFW for the preview gate. */
        nsfwThreshold: Number(process.env.NSFW_THRESHOLD) || 0.5,
        /** FR-040: bounds of the scheduler's runs per day; the backlog moves it between them. */
        minRunsPerDay: Number(process.env.SCHEDULER_MIN_RUNS_PER_DAY) || 10,
        maxRunsPerDay: Number(process.env.SCHEDULER_MAX_RUNS_PER_DAY) || 30,
        /** Backlog size at which the scheduler reaches its maximum frequency. */
        backlogForMaxRuns: Number(process.env.SCHEDULER_BACKLOG_FOR_MAX) || 500,
        /** Files looked at per run, so a run is bounded no matter how big the backlog is. */
        batchSize: Number(process.env.SCHEDULER_BATCH_SIZE) || 100,
        /** Set to `false` on every replica but one (FR-042). */
        schedulerEnabled: (process.env.SCHEDULER_ENABLED ?? 'true') === 'true',
    },

    // OIDC login: each provider is optional; an unconfigured one simply isn't offered.
    oauth: {
        github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
        },
        google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        },
        microsoft: {
            clientId: process.env.MICROSOFT_CLIENT_ID,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        },
        /** Fallback origin for the callback redirect when a request has no usable Host header. */
        frontendBaseUrl: process.env.OAUTH_FRONTEND_BASE_URL,
    },

    buildInfo: {
        version: process.env.APP_VERSION ?? 'dev',
        revision: process.env.APP_REVISION ?? '',
        buildDate: process.env.APP_BUILD_DATE ?? '',
        repositoryUrl: process.env.APP_REPOSITORY_URL ?? 'https://github.com/Wolfi-OwO/burrow',
    },
};

export const isProduction = config.nodeEnv === 'production';

/** 256 bits expressed as characters; `openssl rand -base64 48` yields 64. */
const MIN_JWT_SECRET_LENGTH = 32;

/** Fail fast on missing required configuration, before server.ts does anything else. */
export function validateConfig(): void {
    if (!config.databaseUrl) {
        throw new Error('DATABASE_URL is not set.');
    }
    if (!config.jwtSecret) {
        throw new Error('JWT_SECRET is not set.');
    }
    if (config.jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
        throw new Error(
            `JWT_SECRET must be at least ${String(MIN_JWT_SECRET_LENGTH)} characters — generate one with \`openssl rand -base64 48\`.`,
        );
    }
    if (config.corsAllowedOrigins.length === 0) {
        throw new Error(
            'CORS_ALLOWED_ORIGINS is not set. Set it to this deployment\'s own frontend origin; "*" is not accepted.',
        );
    }
    if (config.corsAllowedOrigins.includes('*')) {
        throw new Error('CORS_ALLOWED_ORIGINS must list real origins.');
    }
    if (config.nodeEnv === 'production' && !config.metricsToken) {
        throw new Error(
            'METRICS_TOKEN is not set. GET /metrics would be fully public in production.',
        );
    }
    const { s3 } = config.storage;
    const s3Set = [s3.endpoint, s3.bucket, s3.accessKeyId, s3.secretAccessKey].filter(
        Boolean,
    ).length;
    if (s3Set !== 0 && s3Set !== 4) {
        throw new Error(
            'S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set together or not at all.',
        );
    }
}
