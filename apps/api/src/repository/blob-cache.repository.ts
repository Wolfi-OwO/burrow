import type { Queryable } from '../database/connection.ts';
import { getPool } from '../database/connection.ts';

export const blobCacheRepository = {
    /** Notes that a blob is (now) in the local cache, and counts that as a use. */
    async register(sha256: string, size: number, db: Queryable = getPool()): Promise<void> {
        await db.query(
            `INSERT INTO blob_cache (sha256, size, last_access) VALUES ($1, $2, now())
             ON CONFLICT (sha256) DO UPDATE SET size = EXCLUDED.size, last_access = now()`,
            [sha256, size],
        );
    },

    async touch(sha256: string, db: Queryable = getPool()): Promise<void> {
        await db.query('UPDATE blob_cache SET last_access = now() WHERE sha256 = $1', [sha256]);
    },

    async forget(sha256: string, db: Queryable = getPool()): Promise<void> {
        await db.query('DELETE FROM blob_cache WHERE sha256 = $1', [sha256]);
    },

    /** @returns How many bytes the cache table says are on the local disk. */
    async totalBytes(db: Queryable = getPool()): Promise<number> {
        const { rows } = await db.query(
            'SELECT coalesce(sum(size), 0)::bigint AS n FROM blob_cache',
        );
        return Number((rows[0] as { n: string }).n);
    },

    /** @returns The least recently used cached blobs, oldest first. */
    async coldest(
        limit: number,
        db: Queryable = getPool(),
    ): Promise<{ sha256: string; size: number }[]> {
        const { rows } = await db.query(
            'SELECT sha256, size FROM blob_cache ORDER BY last_access, sha256 LIMIT $1',
            [limit],
        );
        return rows.map((r) => ({ sha256: r.sha256 as string, size: Number(r.size) }));
    },

    /** @returns Blobs that exist but were never put in the cache table (stored before the S3 store was added). */
    async unregistered(
        limit: number,
        db: Queryable = getPool(),
    ): Promise<{ sha256: string; size: number; mime: string }[]> {
        const { rows } = await db.query(
            `SELECT b.sha256, b.size, b.mime FROM blobs b
             WHERE NOT EXISTS (SELECT 1 FROM blob_cache c WHERE c.sha256 = b.sha256)
             ORDER BY b.created_at LIMIT $1`,
            [limit],
        );
        return rows.map((r) => ({
            sha256: r.sha256 as string,
            size: Number(r.size),
            mime: r.mime as string,
        }));
    },
};
