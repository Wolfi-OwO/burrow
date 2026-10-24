import type { DatabaseRow, Queryable } from '../database/connection.ts';
import { getPool } from '../database/connection.ts';

/** Arbitrary constant: the advisory-lock key that makes exactly one scheduler run at a time (FR-042). */
const SCHEDULER_LOCK_KEY = 874_100_001;

export const schedulerRepository = {
    /** @returns When the last run started, or null if it never ran. */
    async lastRunAt(db: Queryable = getPool()): Promise<Date | null> {
        const { rows } = await db.query('SELECT last_run_at FROM scheduler_state WHERE id = 1');
        return (rows[0]?.last_run_at as Date | null | undefined) ?? null;
    },

    async markRun(db: Queryable = getPool()): Promise<void> {
        await db.query('UPDATE scheduler_state SET last_run_at = now() WHERE id = 1');
    },

    /**
     * Takes the cluster-wide scheduler lock on the given client. Must be released on the SAME
     * connection, so callers pass a transaction-bound client; the lock is also dropped if the
     * connection dies, which is why this is an advisory lock and not a flag in a table.
     *
     * @returns True when this process now owns the scheduler.
     */
    async tryLock(db: Queryable): Promise<boolean> {
        const { rows } = await db.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [
            SCHEDULER_LOCK_KEY,
        ]);
        return (rows[0] as DatabaseRow).locked === true;
    },
};
