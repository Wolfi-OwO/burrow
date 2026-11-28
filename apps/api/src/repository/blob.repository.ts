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

    /** Stores what the file's content hashes to (null when only the bytes identify it) and marks the blob as looked at. */
    async setContentKey(
        sha256: string,
        key: string | null,
        db: Queryable = getPool(),
    ): Promise<void> {
        await db.query(
            'UPDATE blobs SET content_key = $2, content_key_done = true WHERE sha256 = $1',
            [sha256, key],
        );
    },

    /** Blobs nobody has computed a content key for yet, with one of the names they go by. */
    async withoutContentKey(
        limit: number,
        db: Queryable = getPool(),
    ): Promise<{ sha256: string; mime: string; name: string }[]> {
        const { rows } = await db.query(
            `SELECT DISTINCT ON (b.sha256) b.sha256, b.mime, f.name
             FROM blobs b JOIN files f ON f.blob_sha256 = b.sha256
             WHERE NOT b.content_key_done ORDER BY b.sha256 LIMIT $1`,
            [limit],
        );
        return rows.map((r) => ({
            sha256: r.sha256 as string,
            mime: r.mime as string,
            name: r.name as string,
        }));
    },

    /** @returns The stored mime type of a blob, or null. */
    async findMime(sha256: string, db: Queryable = getPool()): Promise<string | null> {
        const { rows } = await db.query('SELECT mime FROM blobs WHERE sha256 = $1', [sha256]);
        return (rows[0]?.mime as string | undefined) ?? null;
    },
};
