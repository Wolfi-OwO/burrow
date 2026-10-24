import { createHash, randomBytes } from 'node:crypto';

import type { DatabaseRow, Queryable } from '../database/connection.ts';
import { getPool } from '../database/connection.ts';
import type { Session } from '../models/user.model.ts';

/**
 * @param token - A raw refresh token.
 * @returns Its SHA-256, which is all the database ever stores of it.
 */
export function hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

function toSession(row: DatabaseRow): Session {
    return {
        id: row.id as string,
        userId: row.user_id as string,
        expiresAt: row.expires_at as Date,
        revokedAt: row.revoked_at as Date | null,
    };
}

export const sessionRepository = {
    /**
     * Opens a session and returns the raw refresh token, which is shown exactly once.
     *
     * @param userId - The owner.
     * @param ttlDays - How long the refresh token lives.
     * @param userAgent - Stored for the owner's own session overview.
     * @returns The session and its raw refresh token.
     */
    async create(
        userId: string,
        ttlDays: number,
        userAgent: string | null,
        db: Queryable = getPool(),
    ): Promise<{ session: Session; refreshToken: string }> {
        const refreshToken = randomBytes(32).toString('base64url');
        const { rows } = await db.query(
            `INSERT INTO sessions (user_id, refresh_hash, user_agent, expires_at)
             VALUES ($1, $2, $3, now() + make_interval(days => $4))
             RETURNING id, user_id, expires_at, revoked_at`,
            [userId, hashRefreshToken(refreshToken), userAgent, ttlDays],
        );
        return { session: toSession(rows[0] as DatabaseRow), refreshToken };
    },

    /** @returns The live (not revoked, not expired) session behind an id, or null. */
    async findLive(id: string, db: Queryable = getPool()): Promise<Session | null> {
        const { rows } = await db.query(
            `SELECT id, user_id, expires_at, revoked_at FROM sessions
             WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()`,
            [id],
        );
        return rows[0] ? toSession(rows[0]) : null;
    },

    /** @returns The live session behind a raw refresh token, or null. */
    async findLiveByRefreshToken(
        token: string,
        db: Queryable = getPool(),
    ): Promise<Session | null> {
        const { rows } = await db.query(
            `SELECT id, user_id, expires_at, revoked_at FROM sessions
             WHERE refresh_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
            [hashRefreshToken(token)],
        );
        return rows[0] ? toSession(rows[0]) : null;
    },

    /**
     * Rotates the refresh token of a session in place: the old one stops working at once.
     *
     * @returns The new raw refresh token.
     */
    async rotate(id: string, ttlDays: number, db: Queryable = getPool()): Promise<string> {
        const refreshToken = randomBytes(32).toString('base64url');
        await db.query(
            `UPDATE sessions SET refresh_hash = $2, expires_at = now() + make_interval(days => $3) WHERE id = $1`,
            [id, hashRefreshToken(refreshToken), ttlDays],
        );
        return refreshToken;
    },

    /** Ends one session (FR-005). */
    async revoke(id: string, db: Queryable = getPool()): Promise<void> {
        await db.query(
            'UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
            [id],
        );
    },

    /**
     * Deletes sessions that expired or were revoked more than `days` ago. Nothing needs them any more, and
     * keeping a login record (with its user agent) forever is retention nobody asked for.
     *
     * @returns How many rows were removed.
     */
    async purgeEnded(days: number, db: Queryable = getPool()): Promise<number> {
        const { rowCount } = await db.query(
            `DELETE FROM sessions
             WHERE expires_at < now() - make_interval(days => $1)
                OR revoked_at < now() - make_interval(days => $1)`,
            [days],
        );
        return rowCount ?? 0;
    },

    /** Ends every session of a user. */
    async revokeAll(userId: string, db: Queryable = getPool()): Promise<void> {
        await db.query(
            'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
            [userId],
        );
    },
};
