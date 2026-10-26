import type { DatabaseRow, Queryable } from '../database/connection.ts';
import { getPool } from '../database/connection.ts';
import type { Category, CategoryNode } from '../models/category.model.ts';

const COLUMNS = 'id, user_id, parent_id, name, path::text AS path, public_preview';

function toCategory(row: DatabaseRow): Category {
    return {
        id: Number(row.id),
        userId: row.user_id as string,
        parentId: row.parent_id === null ? null : Number(row.parent_id),
        name: row.name as string,
        path: row.path as string,
        publicPreview: row.public_preview as boolean,
    };
}

export const categoryRepository = {
    /** @returns One of the user's categories, or null. */
    async findById(
        userId: string,
        id: number,
        db: Queryable = getPool(),
    ): Promise<Category | null> {
        const { rows } = await db.query(
            `SELECT ${COLUMNS} FROM categories WHERE id = $1 AND user_id = $2`,
            [id, userId],
        );
        return rows[0] ? toCategory(rows[0]) : null;
    },

    /**
     * The whole tree in path order, straight from the ltree (FR-013): a parent always
     * precedes its children, so the client renders it without rebuilding structure.
     *
     * @returns Every category of the user with its depth and the number of files filed directly in it.
     */
    async listTree(userId: string, db: Queryable = getPool()): Promise<CategoryNode[]> {
        const { rows } = await db.query(
            `SELECT c.id, c.user_id, c.parent_id, c.name, c.path::text AS path, c.public_preview,
                    nlevel(c.path) - 1 AS depth,
                    (SELECT count(*)::int FROM files f WHERE f.category_id = c.id) AS file_count
             FROM categories c WHERE c.user_id = $1 ORDER BY c.path`,
            [userId],
        );
        return rows.map((row) => ({
            ...toCategory(row),
            depth: Number(row.depth),
            fileCount: Number(row.file_count),
        }));
    },

    /** @returns The direct children of a node, or the top level when `parentId` is null. */
    async listChildren(
        userId: string,
        parentId: number | null,
        db: Queryable = getPool(),
    ): Promise<Category[]> {
        const { rows } = await db.query(
            `SELECT ${COLUMNS} FROM categories WHERE user_id = $1 AND parent_id IS NOT DISTINCT FROM $2 ORDER BY lower(name)`,
            [userId, parentId],
        );
        return rows.map(toCategory);
    },

    /**
     * Creates a node at any depth (FR-010). The path needs the new row's own id as its
     * last label, so the row is inserted first and its path set in the same transaction.
     *
     * @returns The created category.
     * @throws {Error} With code 23505 when a sibling already has the name (the caller maps it to a 409).
     */
    async create(
        userId: string,
        parentId: number | null,
        name: string,
        publicPreview: boolean,
        db: Queryable = getPool(),
    ): Promise<Category> {
        const { rows } = await db.query(
            `INSERT INTO categories (user_id, parent_id, name, path, public_preview)
             VALUES ($1, $2, $3, ''::ltree, $4) RETURNING id`,
            [userId, parentId, name, publicPreview],
        );
        const id = Number((rows[0] as DatabaseRow).id);
        const updated = await db.query(
            `UPDATE categories c
             SET path = COALESCE((SELECT p.path FROM categories p WHERE p.id = c.parent_id), ''::ltree) || c.id::text::ltree
             WHERE c.id = $1 RETURNING ${COLUMNS}`,
            [id],
        );
        return toCategory(updated.rows[0] as DatabaseRow);
    },

    /** Renames a node (FR-011). The path never contains the name, so nothing else moves. */
    async rename(
        userId: string,
        id: number,
        name: string,
        db: Queryable = getPool(),
    ): Promise<Category | null> {
        const { rows } = await db.query(
            `UPDATE categories SET name = $3 WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}`,
            [id, userId, name],
        );
        return rows[0] ? toCategory(rows[0]) : null;
    },

    /** Toggles the flag the NSFW gate (FR-037) reads. */
    async setPublicPreview(
        userId: string,
        id: number,
        value: boolean,
        db: Queryable = getPool(),
    ): Promise<void> {
        await db.query('UPDATE categories SET public_preview = $3 WHERE id = $1 AND user_id = $2', [
            id,
            userId,
            value,
        ]);
    },

    /**
     * Moves a node and its whole subtree under a new parent with ONE statement
     * (FR-014): every descendant's path is rewritten at once, so a failure leaves
     * the tree as it was. Files reference ids, so they resolve to the new path
     * immediately (FR-015).
     *
     * @param newParentId - The new parent, or null for the top level.
     * @returns The moved node, or null when it does not exist.
     * @throws {Error} `INVALID_MOVE` when the target is the node itself or inside its own subtree.
     */
    async move(
        userId: string,
        id: number,
        newParentId: number | null,
        db: Queryable = getPool(),
    ): Promise<Category | null> {
        const node = await this.findById(userId, id, db);
        if (!node) return null;

        let newPrefix = '';
        if (newParentId !== null) {
            const parent = await this.findById(userId, newParentId, db);
            if (!parent) return null;
            const inside = await db.query('SELECT $1::ltree <@ $2::ltree AS inside', [
                parent.path,
                node.path,
            ]);
            if ((inside.rows[0] as DatabaseRow).inside === true) throw new Error('INVALID_MOVE');
            newPrefix = parent.path;
        }

        await db.query(
            `UPDATE categories
             SET path = $2::ltree || subpath(path, nlevel($1::ltree) - 1)
             WHERE user_id = $3 AND path <@ $1::ltree`,
            [node.path, newPrefix, userId],
        );
        const { rows } = await db.query(
            `UPDATE categories SET parent_id = $3 WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}`,
            [id, userId, newParentId],
        );
        return rows[0] ? toCategory(rows[0]) : null;
    },

    /** @returns How many files sit anywhere under a node (the node included). */
    async countFilesInSubtree(
        userId: string,
        id: number,
        db: Queryable = getPool(),
    ): Promise<number> {
        const { rows } = await db.query(
            `SELECT count(*)::int AS n FROM files f JOIN categories c ON c.id = f.category_id
             WHERE f.user_id = $1 AND c.path <@ (SELECT path FROM categories WHERE id = $2 AND user_id = $1)`,
            [userId, id],
        );
        return Number((rows[0] as DatabaseRow).n);
    },

    /** @returns How many direct children a node has. */
    async countChildren(userId: string, id: number, db: Queryable = getPool()): Promise<number> {
        const { rows } = await db.query(
            'SELECT count(*)::int AS n FROM categories WHERE user_id = $1 AND parent_id = $2',
            [userId, id],
        );
        return Number((rows[0] as DatabaseRow).n);
    },

    /** Re-files the files of a node into another category (or none). */
    async refileFiles(
        userId: string,
        from: number,
        to: number | null,
        db: Queryable = getPool(),
    ): Promise<void> {
        await db.query(
            `UPDATE files SET category_id = $3, status = CASE WHEN $3::bigint IS NULL THEN 'unsorted' ELSE status END
             WHERE user_id = $1 AND category_id = $2`,
            [userId, from, to],
        );
    },

    /** Deletes one node; its children and files must already have been moved away. */
    async remove(userId: string, id: number, db: Queryable = getPool()): Promise<boolean> {
        const { rowCount } = await db.query(
            'DELETE FROM categories WHERE id = $1 AND user_id = $2',
            [id, userId],
        );
        return (rowCount ?? 0) > 0;
    },

    /** Every category of one user, for matching names against a recognised place. */
    async listAll(userId: string, db: Queryable = getPool()): Promise<Category[]> {
        const { rows } = await db.query(
            `SELECT id, user_id, parent_id, name, path::text AS path, public_preview FROM categories WHERE user_id = $1`,
            [userId],
        );
        return rows.map(toCategory);
    },
};
