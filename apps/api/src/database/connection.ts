import pg from 'pg';

import { config } from '../config/index.ts';
import { logger } from '../lib/logger.ts';

/** A row shape returned by a query. */
export type DatabaseRow = Record<string, unknown>;

/**
 * The subset of pg's client surface a repository depends on. Both `Pool` and
 * a transaction-bound `PoolClient` satisfy it, which is what lets a
 * repository accept either and so be composed into a transaction without
 * changing.
 */
export interface Queryable {
    /**
     * Run a parameterised SQL query.
     *
     * @param sql - The SQL statement, with `$1`, `$2`, ... placeholders.
     * @param values - Values bound to the statement's placeholders, in order.
     * @returns The matched rows and the row count.
     */
    query<Row extends DatabaseRow>(
        sql: string,
        values?: readonly unknown[],
    ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

export class DatabaseConnectionPool implements Queryable {
    readonly #pool: pg.Pool;

    /**
     * @param connectionString - A PostgreSQL connection URI
     *   (`postgresql://user:pass@host:port/db`).
     */
    public constructor(connectionString: string) {
        this.#pool = new pg.Pool({ connectionString, max: config.databasePoolMax });

        // An idle client erroring means the server dropped it (restart, network,
        // idle timeout). pg surfaces this on the pool; unhandled, it terminates
        // the process.
        this.#pool.on('error', (error: Error) => {
            logger.error({ err: error }, 'idle database client errored');
        });
    }

    /**
     * @param sql - The SQL statement, with `$1`, `$2`, ... placeholders.
     * @param values - Values bound to the statement's placeholders, in order.
     * @returns The matched rows and the row count.
     */
    public async query<Row extends DatabaseRow>(
        sql: string,
        values: readonly unknown[] = [],
    ): Promise<{ rows: Row[]; rowCount: number | null }> {
        const result = await this.#pool.query(sql, values as unknown[]);
        return { rows: result.rows as Row[], rowCount: result.rowCount };
    }

    /**
     * Run `work` inside a transaction, committing on success and rolling back on
     * any thrown error. The client is released in `finally`, so it returns to
     * the pool even if both the work and the rollback throw.
     *
     * @param work - Receives a transaction-scoped `Queryable` and returns the
     *   result to commit.
     * @returns Whatever `work` resolved to, once the transaction has committed.
     */
    public async transaction<Result>(
        work: (client: Queryable) => Promise<Result>,
    ): Promise<Result> {
        const client = await this.#pool.connect();
        try {
            await client.query('BEGIN');
            const result = await work(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                logger.error({ err: rollbackError }, 'transaction rollback failed');
            }
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * True when the database answers. Backs a future readiness probe.
     *
     * @returns Whether a trivial query against the pool succeeded.
     */
    public async isReachable(): Promise<boolean> {
        try {
            await this.#pool.query('SELECT 1');
            return true;
        } catch {
            return false;
        }
    }

    /** Drain the pool. Called from the shutdown handler. */
    public async shutdown(): Promise<void> {
        await this.#pool.end();
    }
}

let sharedPool: DatabaseConnectionPool | undefined;

/**
 * Returns the process-wide connection pool, creating it on first call.
 *
 * @returns The shared {@link DatabaseConnectionPool} instance.
 */
export function getPool(): DatabaseConnectionPool {
    if (!sharedPool) {
        // Independent guard, not just a mirror of validateConfig(): routes
        // that construct their repository at module scope (e.g.
        // routes/users.routes.ts) call this during ES module import
        // evaluation, which happens before server.ts's own top-level
        // validateConfig() call runs.
        if (!config.databaseUrl) {
            throw new Error('DATABASE_URL is not set.');
        }
        sharedPool = new DatabaseConnectionPool(config.databaseUrl);
    }
    return sharedPool;
}
