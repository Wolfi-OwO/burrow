import type { DatabaseRow, Queryable } from '../database/connection.ts';
import { getPool } from '../database/connection.ts';

export type ShareAccess = 'link' | 'users';

export interface ShareUser {
    id: string;
    username: string;
    displayName: string;
}

export interface Share {
    id: string;
    ownerId: string;
    token: string;
    fileId: string | null;
    categoryId: number | null;
    access: ShareAccess;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    /** The file name or the category name, whichever the link points at. */
    targetName: string;
    ownerName: string;
    users: ShareUser[];
}

const SELECT = `SELECT s.id, s.owner_id, s.token, s.file_id, s.category_id, s.access, s.expires_at, s.revoked_at, s.created_at,
        COALESCE(f.name, c.name) AS target_name, o.display_name AS owner_name,
        COALESCE((SELECT json_agg(json_build_object('id', u.id, 'username', u.username, 'displayName', u.display_name)
                                  ORDER BY u.display_name)
                  FROM share_users su JOIN users u ON u.id = su.user_id WHERE su.share_id = s.id), '[]'::json) AS users
    FROM shares s JOIN users o ON o.id = s.owner_id
    LEFT JOIN files f ON f.id = s.file_id LEFT JOIN categories c ON c.id = s.category_id`;

function toShare(row: DatabaseRow): Share {
    return {
        id: row.id as string,
        ownerId: row.owner_id as string,
        token: row.token as string,
        fileId: row.file_id as string | null,
        categoryId: row.category_id === null ? null : Number(row.category_id),
        access: row.access as ShareAccess,
        expiresAt: row.expires_at as Date | null,
        revokedAt: row.revoked_at as Date | null,
        createdAt: row.created_at as Date,
        targetName: row.target_name as string,
        ownerName: row.owner_name as string,
        users: row.users as ShareUser[],
    };
}

export const shareRepository = {
    async create(
        input: {
            ownerId: string;
            token: string;
            fileId: string | null;
            categoryId: number | null;
            access: ShareAccess;
            expiresAt: Date | null;
        },
        db: Queryable = getPool(),
    ): Promise<string> {
        const { rows } = await db.query(
            `INSERT INTO shares (owner_id, token, file_id, category_id, access, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [
                input.ownerId,
                input.token,
                input.fileId,
                input.categoryId,
                input.access,
                input.expiresAt,
            ],
        );
        return (rows[0] as DatabaseRow).id as string;
    },

    async findById(id: string, db: Queryable = getPool()): Promise<Share | null> {
        const { rows } = await db.query(`${SELECT} WHERE s.id = $1`, [id]);
        return rows[0] ? toShare(rows[0]) : null;
    },

    async findByToken(token: string, db: Queryable = getPool()): Promise<Share | null> {
        const { rows } = await db.query(`${SELECT} WHERE s.token = $1`, [token]);
        return rows[0] ? toShare(rows[0]) : null;
    },

    async listByOwner(ownerId: string, db: Queryable = getPool()): Promise<Share[]> {
        const { rows } = await db.query(
            `${SELECT} WHERE s.owner_id = $1 ORDER BY s.created_at DESC`,
            [ownerId],
        );
        return rows.map(toShare);
    },

    /** Live user-restricted shares naming this account. */
    async listForUser(userId: string, db: Queryable = getPool()): Promise<Share[]> {
        const { rows } = await db.query(
            `${SELECT} WHERE s.access = 'users' AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now())
               AND EXISTS (SELECT 1 FROM share_users x WHERE x.share_id = s.id AND x.user_id = $1)
             ORDER BY s.created_at DESC`,
            [userId],
        );
        return rows.map(toShare);
    },

    async setUsers(shareId: string, userIds: string[], db: Queryable = getPool()): Promise<void> {
        await db.query('DELETE FROM share_users WHERE share_id = $1', [shareId]);
        if (userIds.length === 0) return;
        await db.query(
            `INSERT INTO share_users (share_id, user_id)
             SELECT $1, u.id FROM users u WHERE u.id = ANY($2::uuid[])`,
            [shareId, userIds],
        );
    },

    async update(
        id: string,
        patch: { access?: ShareAccess; expiresAt?: Date | null; revoked?: boolean },
        db: Queryable = getPool(),
    ): Promise<void> {
        const sets: string[] = [];
        const values: unknown[] = [id];
        if (patch.access !== undefined) {
            values.push(patch.access);
            sets.push(`access = $${String(values.length)}`);
        }
        if (patch.expiresAt !== undefined) {
            values.push(patch.expiresAt);
            sets.push(`expires_at = $${String(values.length)}`);
        }
        if (patch.revoked !== undefined)
            sets.push(patch.revoked ? 'revoked_at = now()' : 'revoked_at = NULL');
        if (sets.length === 0) return;
        await db.query(`UPDATE shares SET ${sets.join(', ')} WHERE id = $1`, values);
    },

    async remove(id: string, db: Queryable = getPool()): Promise<void> {
        await db.query('DELETE FROM shares WHERE id = $1', [id]);
    },

    /** Name or username fragment, other accounts only; capped, because this is a type-ahead. */
    async searchUsers(
        q: string,
        exceptId: string,
        db: Queryable = getPool(),
    ): Promise<ShareUser[]> {
        const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
        const { rows } = await db.query(
            `SELECT id, username, display_name FROM users
             WHERE id <> $1 AND (username ILIKE $2 OR display_name ILIKE $2) ORDER BY display_name LIMIT 8`,
            [exceptId, like],
        );
        return rows.map((r) => ({
            id: r.id as string,
            username: r.username as string,
            displayName: r.display_name as string,
        }));
    },
};
