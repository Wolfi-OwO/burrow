import type { Queryable } from '../database/connection.ts';
import { getPool } from '../database/connection.ts';

export const blobRepository = {
    /**
     * Registers a blob by content hash; a second upload of the same bytes changes nothing.
     *
     * @returns True when the blob row is new, false on a dedup hit (FR-016).
     */
    async insertIfAbsent(
        sha256: string,
        size: number,
        mime: string,
        db: Queryable = getPool(),
    ): Promise<boolean> {
        const { rowCount } = await db.query(
            'INSERT INTO blobs (sha256, size, mime) VALUES ($1, $2, $3) ON CONFLICT (sha256) DO NOTHING',
            [sha256, size, mime],
        );
        return (rowCount ?? 0) > 0;
    },

    /** @returns The stored mime type of a blob, or null. */
    async findMime(sha256: string, db: Queryable = getPool()): Promise<string | null> {
        const { rows } = await db.query('SELECT mime FROM blobs WHERE sha256 = $1', [sha256]);
        return (rows[0]?.mime as string | undefined) ?? null;
    },
};
