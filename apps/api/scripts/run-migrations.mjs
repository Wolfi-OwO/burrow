#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'database', 'migrations');

/**
 * How long to keep retrying the FIRST connection before giving up. 60s is
 * chosen against the measurement below: the gap this has to survive was
 * ~0.8s in CI, and a cold Azure Container Apps + Flexible Server wake is
 * tens of seconds. Anything past that is a real outage, not a race, and
 * should fail loudly rather than hang the deployment.
 */
const CONNECT_BUDGET_MS = 60_000;

/**
 * Error codes meaning "nobody is listening yet", as opposed to "your
 * credentials are wrong". Only these are retried, so a bad password still
 * fails in under a second with its own message instead of spinning for a
 * minute. 57P03 is Postgres' own cannot_connect_now, sent while the server
 * is still starting up or recovering.
 */
const RETRIABLE_CONNECT_CODES = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'EAI_AGAIN',
    'ENOTFOUND',
    'ETIMEDOUT',
    '57P03',
]);

/**
 * Connect, retrying with bounded backoff while the server is merely not up yet.
 *
 * Why this exists — the postgres entrypoint starts TWICE. It boots a temporary
 * server for /docker-entrypoint-initdb.d with `listen_addresses=''` (Unix
 * socket only, TCP off), shuts it down, then starts the real one. Anything
 * connecting over TCP inside that window is refused. From CI run 32888417180,
 * job 97934272763, all times UTC:
 *
 *   19:15:12.921  temp init server ready to accept connections
 *   19:15:14.523  nutrilens-api-1 Started   <- inside the window
 *   19:15:15.233  temp server received fast shutdown request
 *   19:15:15.359  REAL server ready to accept connections
 *
 * This script connected at ~19:15:14.6, got ECONNREFUSED 172.18.0.2:5432,
 * exited 1, and so `run-migrations && node dist/server.js` never reached the
 * server. Postgres then stayed up and idle for the next TEN MINUTES while the
 * health wait polled a container that was already gone — which is why raising
 * the CI timeout would not have helped by a single second.
 *
 * Switching to postgis/postgis in #184 is what made this reproducible: its
 * init scripts stretched the temp-server phase to ~2.3s, wide enough for
 * compose's 2s healthcheck interval to land inside it.
 *
 * Production has the same shape and gets the same benefit: Azure Container
 * Apps scales to zero, so a cold start races a database that is also waking.
 *
 * @param {string} connectionString - PostgreSQL connection URI.
 * @param {number} budgetMs - Total time to keep retrying before rethrowing.
 * @returns {Promise<import('pg').Client>} A connected client.
 */
export async function connectWithRetry(connectionString, budgetMs = CONNECT_BUDGET_MS) {
    const deadline = Date.now() + budgetMs;
    let delayMs = 250;

    for (;;) {
        // A fresh client per attempt: pg refuses to reconnect one whose
        // connect() already failed ("Client has already been connected").
        const client = new pg.Client({ connectionString });
        try {
            await client.connect();
            return client;
        } catch (error) {
            await client.end().catch(() => {});
            if (!RETRIABLE_CONNECT_CODES.has(error?.code) || Date.now() >= deadline) throw error;
            console.log(
                `Database not accepting connections yet (${error.code}); retrying in ${delayMs}ms ...`,
            );
            await sleep(delayMs);
            delayMs = Math.min(delayMs * 2, 5_000);
        }
    }
}

async function main() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.error('DATABASE_URL is not set. Did you pass --env-file=.env?');
        process.exit(1);
    }

    const client = await connectWithRetry(databaseUrl);
    try {
        await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

        const applied = new Set(
            (await client.query('SELECT filename FROM schema_migrations')).rows.map(
                (r) => r.filename,
            ),
        );
        const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

        let count = 0;
        for (const file of files) {
            if (applied.has(file)) continue;
            const sql = await readFile(join(migrationsDir, file), 'utf8');
            console.log(`Applying ${file} ...`);
            try {
                await client.query('BEGIN');
                await client.query(sql);
                await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
                await client.query('COMMIT');
                count += 1;
            } catch (error) {
                await client.query('ROLLBACK');
                throw new Error(`Migration ${file} failed: ${error.message}`, { cause: error });
            }
        }
        console.log(
            count === 0 ? 'Database already up to date.' : `Applied ${count} migration(s).`,
        );
    } finally {
        await client.end();
    }
}

// Only run when executed directly, so tests can import connectWithRetry
// without applying every migration as a side effect of the import.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
