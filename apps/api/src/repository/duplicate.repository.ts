import type { Queryable } from '../database/connection.ts';
import { getPool } from '../database/connection.ts';

/** Arbitrary constant: the advisory-lock key that lets one process at a time run the duplicate comparison. */
const DUPLICATE_LOCK_KEY = 874_100_002;

export interface CleanRun {
    mode: 'exact' | 'similar';
    total: number;
    done: number;
    removed: number;
    active: boolean;
    startedAt: Date;
    finishedAt: Date | null;
}

const toRun = (row: Record<string, unknown>): CleanRun => ({
    mode: row.mode as 'exact' | 'similar',
    total: Number(row.total),
    done: Number(row.done),
    removed: Number(row.removed),
    active: row.active === true,
    startedAt: row.started_at as Date,
    finishedAt: (row.finished_at as Date | null) ?? null,
});

export const duplicateRepository = {
    /** Writes down that "Remove all duplicates" is going to remove `total` files, replacing the account's last run. */
    async beginClean(
        userId: string,
        mode: 'exact' | 'similar',
        total: number,
        db: Queryable = getPool(),
    ): Promise<void> {
        await db.query(
            `INSERT INTO duplicate_clean_runs (user_id, mode, total) VALUES ($1, $2, $3)
             ON CONFLICT (user_id) DO UPDATE SET mode = $2, total = $3, done = 0, removed = 0,
                 active = true, started_at = now(), finished_at = NULL`,
            [userId, mode, total],
        );
    },

    async progressClean(
        userId: string,
        done: number,
        removed: number,
        db: Queryable = getPool(),
    ): Promise<void> {
        await db.query(
            'UPDATE duplicate_clean_runs SET done = $2, removed = $3 WHERE user_id = $1',
            [userId, done, removed],
        );
    },

    async endClean(userId: string, db: Queryable = getPool()): Promise<void> {
        await db.query(
            'UPDATE duplicate_clean_runs SET active = false, finished_at = now() WHERE user_id = $1',
            [userId],
        );
    },

    /** @returns The account's latest run (going or finished), or null when it never ran one. */
    async cleanRun(userId: string, db: Queryable = getPool()): Promise<CleanRun | null> {
        const { rows } = await db.query('SELECT * FROM duplicate_clean_runs WHERE user_id = $1', [
            userId,
        ]);
        return rows[0] ? toRun(rows[0]) : null;
    },

    /** @returns The runs that were going when the server last stopped. */
    async activeCleans(
        db: Queryable = getPool(),
    ): Promise<{ userId: string; mode: 'exact' | 'similar'; total: number }[]> {
        const { rows } = await db.query(
            'SELECT user_id, mode, total FROM duplicate_clean_runs WHERE active',
        );
        return rows.map((r) => ({
            userId: r.user_id as string,
            mode: r.mode as 'exact' | 'similar',
            total: Number(r.total),
        }));
    },

    /** @returns The accounts that own these files, so each can be told its comparison moved on. */
    async ownersOf(ids: string[], db: Queryable = getPool()): Promise<string[]> {
        const { rows } = await db.query(
            'SELECT DISTINCT user_id FROM files WHERE id = ANY($1::uuid[])',
            [ids],
        );
        return rows.map((r) => r.user_id as string);
    },

    /** Takes the comparison lock for this transaction. @returns True when this process may compare now. */
    async tryLock(db: Queryable): Promise<boolean> {
        const { rows } = await db.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [
            DUPLICATE_LOCK_KEY,
        ]);
        return rows[0]?.locked === true;
    },

    /** @returns The oldest files that have a picture embedding and were never compared. */
    async pending(limit: number, db: Queryable = getPool()): Promise<string[]> {
        const { rows } = await db.query(
            `SELECT id FROM files WHERE embedding IS NOT NULL AND dup_checked_at IS NULL
             ORDER BY created_at LIMIT $1`,
            [limit],
        );
        return rows.map((r) => r.id as string);
    },

    /**
     * Compares these files with all of their owner's files and stores the pairs that are nearly the same picture. A
     * pair is found from whichever side is checked first, so a new file also finds its older copies. Each file's few
     * nearest neighbours only, so the cost stays linear in the drive.
     *
     * @returns How many new pairs were stored.
     */
    async compare(ids: string[], maxDistance: number, db: Queryable = getPool()): Promise<number> {
        // The index is shared by every account; with iterative scanning it keeps looking until it has the neighbours
        // that belong to this account, so a small drive next to big ones does not lose its matches.
        await db.query(`SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true)`);
        const { rowCount } = await db.query(
            `INSERT INTO duplicate_pairs (a_id, b_id, user_id, distance)
             SELECT least(a.id, n.id), greatest(a.id, n.id), a.user_id, min(n.d)
             FROM files a
             CROSS JOIN LATERAL (
                 SELECT b.id, (b.embedding <=> a.embedding)::real AS d FROM files b
                 WHERE b.user_id = a.user_id AND b.id <> a.id AND b.blob_sha256 <> a.blob_sha256
                   AND b.embedding IS NOT NULL
                 ORDER BY b.embedding <=> a.embedding LIMIT 6
             ) n
             WHERE a.id = ANY($1::uuid[]) AND a.embedding IS NOT NULL AND n.d < $2
             GROUP BY least(a.id, n.id), greatest(a.id, n.id), a.user_id
             ON CONFLICT DO NOTHING`,
            [ids, maxDistance],
        );
        await db.query('UPDATE files SET dup_checked_at = now() WHERE id = ANY($1::uuid[])', [ids]);
        return rowCount ?? 0;
    },

    /** The stored pairs of one user under the current threshold. */
    async pairs(
        userId: string,
        maxDistance: number,
        db: Queryable = getPool(),
    ): Promise<[string, string][]> {
        const { rows } = await db.query(
            'SELECT a_id, b_id FROM duplicate_pairs WHERE user_id = $1 AND distance < $2',
            [userId, maxDistance],
        );
        return rows.map((r) => [r.a_id as string, r.b_id as string]);
    },

    /** How far the comparison is for one user: pictures compared and still waiting. */
    async progress(
        userId: string,
        db: Queryable = getPool(),
    ): Promise<{ checked: number; pending: number }> {
        const { rows } = await db.query(
            `SELECT count(*) FILTER (WHERE dup_checked_at IS NOT NULL)::int AS checked,
                    count(*) FILTER (WHERE dup_checked_at IS NULL)::int AS pending
             FROM files WHERE user_id = $1 AND embedding IS NOT NULL`,
            [userId],
        );
        const row = rows[0] as { checked: number; pending: number };
        return { checked: row.checked, pending: row.pending };
    },

    /** A file's picture changed (it was looked at again): its old pairs are void and it is compared anew. */
    async forget(fileId: string, db: Queryable = getPool()): Promise<void> {
        await db.query('DELETE FROM duplicate_pairs WHERE a_id = $1 OR b_id = $1', [fileId]);
        await db.query('UPDATE files SET dup_checked_at = NULL WHERE id = $1', [fileId]);
    },
};
