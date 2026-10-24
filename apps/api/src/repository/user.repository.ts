import type { DatabaseRow, Queryable } from '../database/connection.ts';
import { getPool } from '../database/connection.ts';
import type { Role } from '../lib/jwt.ts';
import type { User } from '../models/user.model.ts';

const COLUMNS = 'id, username, password_hash, display_name, bio, avatar_sha256, role, created_at';

function toUser(row: DatabaseRow): User {
    return {
        id: row.id as string,
        username: row.username as string,
        passwordHash: row.password_hash as string | null,
        displayName: row.display_name as string,
        bio: row.bio as string,
        avatarSha256: row.avatar_sha256 as string | null,
        role: row.role as Role,
        createdAt: row.created_at as Date,
    };
}

export const userRepository = {
    /**
     * @param id - The user id.
     * @param db - Pool or transaction client.
     * @returns The user, or null.
     */
    async findById(id: string, db: Queryable = getPool()): Promise<User | null> {
        const { rows } = await db.query(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
        return rows[0] ? toUser(rows[0]) : null;
    },

    /**
     * @param username - Matched case-insensitively.
     * @param db - Pool or transaction client.
     * @returns The user, or null.
     */
    async findByUsername(username: string, db: Queryable = getPool()): Promise<User | null> {
        const { rows } = await db.query(
            `SELECT ${COLUMNS} FROM users WHERE lower(username) = lower($1)`,
            [username],
        );
        return rows[0] ? toUser(rows[0]) : null;
    },

    /** @returns How many accounts exist; registration closes once the owner does. */
    async count(db: Queryable = getPool()): Promise<number> {
        const { rows } = await db.query('SELECT count(*)::int AS n FROM users');
        return rows[0]?.n as number;
    },

    /**
     * @param input - The new account's fields.
     * @param db - Pool or transaction client.
     * @returns The created user.
     */
    async create(
        input: { username: string; passwordHash: string | null; displayName: string; role: Role },
        db: Queryable = getPool(),
    ): Promise<User> {
        const { rows } = await db.query(
            `INSERT INTO users (username, password_hash, display_name, role) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
            [input.username, input.passwordHash, input.displayName, input.role],
        );
        return toUser(rows[0] as DatabaseRow);
    },

    /**
     * @param id - The user id.
     * @param patch - Fields to change (FR-018: independent of the login identity).
     * @returns The updated user, or null.
     */
    async updateProfile(
        id: string,
        patch: { displayName?: string; bio?: string; avatarSha256?: string },
        db: Queryable = getPool(),
    ): Promise<User | null> {
        const { rows } = await db.query(
            `UPDATE users SET display_name = COALESCE($2, display_name), bio = COALESCE($3, bio),
                    avatar_sha256 = COALESCE($4, avatar_sha256) WHERE id = $1 RETURNING ${COLUMNS}`,
            [id, patch.displayName ?? null, patch.bio ?? null, patch.avatarSha256 ?? null],
        );
        return rows[0] ? toUser(rows[0]) : null;
    },

    /** Sets or replaces the password hash (an OIDC-only account adding a password). */
    async setPasswordHash(id: string, hash: string, db: Queryable = getPool()): Promise<void> {
        await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, hash]);
    },
};
