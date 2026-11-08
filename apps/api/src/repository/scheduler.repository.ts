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

    /** Writes down that a "Sort now" run is going, over `total` files, so a restart can resume it. */
    async beginRun(total: number, db: Queryable = getPool()): Promise<void> {
        await db.query(
            'UPDATE scheduler_state SET run_active = true, run_total = $1, run_started_at = now() WHERE id = 1',
            [total],
        );
    },

    async endRun(db: Queryable = getPool()): Promise<void> {
        await db.query('UPDATE scheduler_state SET run_active = false WHERE id = 1');
    },

    /** @returns The run that was going when the server last stopped, or null when none was. */
    async activeRun(db: Queryable = getPool()): Promise<{ total: number; startedAt: Date } | null> {
        const { rows } = await db.query(
            'SELECT run_active, run_total, run_started_at FROM scheduler_state WHERE id = 1',
        );
        const row = rows[0];
        if (row?.run_active !== true) return null;
        return { total: Number(row.run_total), startedAt: row.run_started_at as Date };
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
