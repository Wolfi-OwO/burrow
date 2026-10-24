import type { DatabaseRow, Queryable } from '../database/connection.ts';
import { getPool } from '../database/connection.ts';
import type { FileRecord, FileStatus, FileView } from '../models/file.model.ts';

const COLUMNS = `f.id, f.user_id, f.blob_sha256, f.name, f.mime, f.size, f.category_id, f.status,
    f.suggested_category_id, f.confidence, f.nsfw_score, f.classified_at, f.created_at`;

/** Ancestor names, root first. The join is on the ltree's own ancestor operator, never on names (ADR-0003). */
const CATEGORY_PATH = `COALESCE((SELECT array_agg(a.name ORDER BY nlevel(a.path))
    FROM categories a WHERE c.id IS NOT NULL AND a.path @> c.path AND a.user_id = f.user_id), '{}') AS category_path`;

function toRecord(row: DatabaseRow): FileRecord {
    return {
        id: row.id as string,
        userId: row.user_id as string,
        blobSha256: row.blob_sha256 as string,
        name: row.name as string,
        mime: row.mime as string,
        size: Number(row.size),
        categoryId: row.category_id === null ? null : Number(row.category_id),
        status: row.status as FileStatus,
        suggestedCategoryId:
            row.suggested_category_id === null ? null : Number(row.suggested_category_id),
        confidence: row.confidence === null ? null : Number(row.confidence),
        nsfwScore: row.nsfw_score === null ? null : Number(row.nsfw_score),
        classifiedAt: row.classified_at as Date | null,
        createdAt: row.created_at as Date,
    };
}

function toView(row: DatabaseRow): FileView {
    return {
        ...toRecord(row),
        categoryPath: (row.category_path as string[] | null) ?? [],
        ...(row.rank === undefined ? {} : { rank: Number(row.rank) }),
    };
}

export interface FileListFilter {
    /** A category id, or `unsorted` for files in no category. Omitted → everything. */
    category?: number | 'unsorted';
    status?: FileStatus;
    /** Include the whole subtree of `category`, not only files filed directly in it. */
    subtree?: boolean;
    limit: number;
    offset: number;
}

export const fileRepository = {
    /** Creates a file row for an already stored blob. */
    async create(
        input: { userId: string; blobSha256: string; name: string; mime: string; size: number },
        db: Queryable = getPool(),
    ): Promise<FileRecord> {
        const { rows } = await db.query(
            `INSERT INTO files (user_id, blob_sha256, name, mime, size) VALUES ($1, $2, $3, $4, $5)
             RETURNING id, user_id, blob_sha256, name, mime, size, category_id, status, suggested_category_id,
                       confidence, nsfw_score, classified_at, created_at`,
            [input.userId, input.blobSha256, input.name, input.mime, input.size],
        );
        return toRecord(rows[0] as DatabaseRow);
    },

    /** @returns One of the user's files with its category path, or null. */
    async findById(
        userId: string,
        id: string,
        db: Queryable = getPool(),
    ): Promise<FileView | null> {
        const { rows } = await db.query(
            `SELECT ${COLUMNS}, ${CATEGORY_PATH} FROM files f LEFT JOIN categories c ON c.id = f.category_id
             WHERE f.id = $1 AND f.user_id = $2`,
            [id, userId],
        );
        return rows[0] ? toView(rows[0]) : null;
    },

    /** @returns A page of the user's files, newest first. */
    async list(
        userId: string,
        filter: FileListFilter,
        db: Queryable = getPool(),
    ): Promise<FileView[]> {
        const where: string[] = ['f.user_id = $1'];
        const values: unknown[] = [userId];
        if (filter.status) {
            values.push(filter.status);
            where.push(`f.status = $${String(values.length)}`);
        }
        if (filter.category === 'unsorted') {
            where.push('f.category_id IS NULL');
        } else if (typeof filter.category === 'number') {
            values.push(filter.category);
            const idx = String(values.length);
            where.push(
                filter.subtree
                    ? `c.path <@ (SELECT path FROM categories WHERE id = $${idx} AND user_id = f.user_id)`
                    : `f.category_id = $${idx}`,
            );
        }
        values.push(filter.limit, filter.offset);
        const { rows } = await db.query(
            `SELECT ${COLUMNS}, ${CATEGORY_PATH} FROM files f LEFT JOIN categories c ON c.id = f.category_id
             WHERE ${where.join(' AND ')} ORDER BY f.created_at DESC, f.id
             LIMIT $${String(values.length - 1)} OFFSET $${String(values.length)}`,
            values,
        );
        return rows.map(toView);
    },

    /**
     * Full-text search ranked by ts_rank (FR-020); each hit carries its position in the tree (FR-021).
     *
     * @param query - Free text; parsed by websearch_to_tsquery, so quotes and `-` work and bad syntax cannot throw.
     */
    async search(
        userId: string,
        query: string,
        limit: number,
        db: Queryable = getPool(),
    ): Promise<FileView[]> {
        const { rows } = await db.query(
            `SELECT ${COLUMNS}, ${CATEGORY_PATH}, ts_rank(f.search, q.query) AS rank
             FROM files f
             CROSS JOIN websearch_to_tsquery('simple', $2) AS q(query)
             LEFT JOIN categories c ON c.id = f.category_id
             WHERE f.user_id = $1 AND f.search @@ q.query
             ORDER BY rank DESC, f.created_at DESC LIMIT $3`,
            [userId, query, limit],
        );
        return rows.map(toView);
    },

    /** Files the scheduler has not looked at yet, oldest first (FR-041). */
    async nextBacklog(limit: number, db: Queryable = getPool()): Promise<FileRecord[]> {
        const { rows } = await db.query(
            `SELECT ${COLUMNS} FROM files f WHERE f.classified_at IS NULL AND f.status = 'unsorted'
             ORDER BY f.created_at LIMIT $1`,
            [limit],
        );
        return rows.map(toRecord);
    },

    /** @returns How many files still wait for a scheduler run; it sets the run frequency (FR-040). */
    async backlogSize(db: Queryable = getPool()): Promise<number> {
        const { rows } = await db.query(
            `SELECT count(*)::int AS n FROM files WHERE classified_at IS NULL AND status = 'unsorted'`,
        );
        return Number((rows[0] as DatabaseRow).n);
    },

    /** Records what a scheduler run decided: filed, or sent to review. */
    async setClassification(
        id: string,
        result: {
            status: FileStatus;
            categoryId: number | null;
            suggestedCategoryId: number | null;
            confidence: number | null;
            nsfwScore: number | null;
            embedding: number[] | null;
        },
        db: Queryable = getPool(),
    ): Promise<void> {
        await db.query(
            `UPDATE files SET status = $2, category_id = $3, suggested_category_id = $4, confidence = $5,
                    nsfw_score = $6, embedding = $7::vector, classified_at = now() WHERE id = $1`,
            [
                id,
                result.status,
                result.categoryId,
                result.suggestedCategoryId,
                result.confidence,
                result.nsfwScore,
                result.embedding ? `[${result.embedding.join(',')}]` : null,
            ],
        );
    },

    /** Files filed by hand or by accepting a suggestion. */
    async setCategory(
        userId: string,
        id: string,
        categoryId: number | null,
        db: Queryable = getPool(),
    ): Promise<boolean> {
        const { rowCount } = await db.query(
            `UPDATE files SET category_id = $3, status = CASE WHEN $3::bigint IS NULL THEN 'unsorted' ELSE 'sorted' END,
                    suggested_category_id = NULL, classified_at = COALESCE(classified_at, now())
             WHERE id = $1 AND user_id = $2`,
            [id, userId, categoryId],
        );
        return (rowCount ?? 0) > 0;
    },

    /**
     * Closes a review item without filing it (FR-044). `classified_at` stays set, so
     * the item never returns to a scheduler run (FR-045).
     */
    async leaveUnsorted(userId: string, id: string, db: Queryable = getPool()): Promise<boolean> {
        const { rowCount } = await db.query(
            `UPDATE files SET status = 'unsorted', suggested_category_id = NULL WHERE id = $1 AND user_id = $2 AND status = 'review'`,
            [id, userId],
        );
        return (rowCount ?? 0) > 0;
    },

    async rename(
        userId: string,
        id: string,
        name: string,
        db: Queryable = getPool(),
    ): Promise<boolean> {
        const { rowCount } = await db.query(
            'UPDATE files SET name = $3 WHERE id = $1 AND user_id = $2',
            [id, userId, name],
        );
        return (rowCount ?? 0) > 0;
    },

    /** @returns The blob hash of the deleted file, so the caller can drop the blob if nothing else uses it; null if absent. */
    async remove(userId: string, id: string, db: Queryable = getPool()): Promise<string | null> {
        const { rows } = await db.query(
            'DELETE FROM files WHERE id = $1 AND user_id = $2 RETURNING blob_sha256',
            [id, userId],
        );
        return (rows[0]?.blob_sha256 as string | undefined) ?? null;
    },

    /** @returns How many files (and avatars) still reference a blob. */
    async blobReferences(sha256: string, db: Queryable = getPool()): Promise<number> {
        const { rows } = await db.query(
            `SELECT (SELECT count(*) FROM files WHERE blob_sha256 = $1) + (SELECT count(*) FROM users WHERE avatar_sha256 = $1) AS n`,
            [sha256],
        );
        return Number((rows[0] as DatabaseRow).n);
    },

    /** @returns The review queue: files below the threshold, each with its suggestion. */
    async listReview(
        userId: string,
        db: Queryable = getPool(),
    ): Promise<(FileView & { suggestedName: string | null })[]> {
        const { rows } = await db.query(
            `SELECT ${COLUMNS}, ${CATEGORY_PATH}, s.name AS suggested_name
             FROM files f LEFT JOIN categories c ON c.id = f.category_id
             LEFT JOIN categories s ON s.id = f.suggested_category_id
             WHERE f.user_id = $1 AND f.status = 'review' ORDER BY f.created_at`,
            [userId],
        );
        return rows.map((row) => ({
            ...toView(row),
            suggestedName: row.suggested_name as string | null,
        }));
    },
};
