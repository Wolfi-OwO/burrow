import type { DatabaseRow, Queryable } from '../database/connection.ts';
import { getPool } from '../database/connection.ts';
import type { Provider, UserIdentity } from '../models/user.model.ts';

const COLUMNS = 'id, user_id, provider, provider_user_id, email, email_verified';

function toIdentity(row: DatabaseRow): UserIdentity {
    return {
        id: row.id as number,
        userId: row.user_id as string,
        provider: row.provider as Provider,
        providerUserId: row.provider_user_id as string,
        email: row.email as string | null,
        emailVerified: row.email_verified as boolean,
    };
}

export const identityRepository = {
    /** @returns The identity a provider account is already linked as, or null. */
    async find(
        provider: Provider,
        providerUserId: string,
        db: Queryable = getPool(),
    ): Promise<UserIdentity | null> {
        const { rows } = await db.query(
            `SELECT ${COLUMNS} FROM user_identities WHERE provider = $1 AND provider_user_id = $2`,
            [provider, providerUserId],
        );
        return rows[0] ? toIdentity(rows[0]) : null;
    },

    /** @returns Every provider linked to a user. */
    async listForUser(userId: string, db: Queryable = getPool()): Promise<UserIdentity[]> {
        const { rows } = await db.query(
            `SELECT ${COLUMNS} FROM user_identities WHERE user_id = $1 ORDER BY provider`,
            [userId],
        );
        return rows.map(toIdentity);
    },

    /** Links a provider account to a user. */
    async create(
        input: {
            userId: string;
            provider: Provider;
            providerUserId: string;
            email: string | null;
            emailVerified: boolean;
        },
        db: Queryable = getPool(),
    ): Promise<UserIdentity> {
        const { rows } = await db.query(
            `INSERT INTO user_identities (user_id, provider, provider_user_id, email, email_verified)
             VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
            [input.userId, input.provider, input.providerUserId, input.email, input.emailVerified],
        );
        return toIdentity(rows[0] as DatabaseRow);
    },

    /** Removes a link; the caller has already checked another login method remains. */
    async remove(userId: string, provider: Provider, db: Queryable = getPool()): Promise<boolean> {
        const { rowCount } = await db.query(
            'DELETE FROM user_identities WHERE user_id = $1 AND provider = $2',
            [userId, provider],
        );
        return (rowCount ?? 0) > 0;
    },

    /** @returns The user a verified email belongs to (any linked identity with that email), or null. */
    async findUserIdByVerifiedEmail(
        email: string,
        db: Queryable = getPool(),
    ): Promise<string | null> {
        const { rows } = await db.query(
            'SELECT user_id FROM user_identities WHERE lower(email) = lower($1) AND email_verified LIMIT 1',
            [email],
        );
        return (rows[0]?.user_id as string | undefined) ?? null;
    },
};
