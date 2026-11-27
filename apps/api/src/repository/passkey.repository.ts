import type { DatabaseRow, Queryable } from '../database/connection.ts';
import { getPool } from '../database/connection.ts';

export interface Passkey {
    id: string;
    userId: string;
    credentialId: string;
    publicKey: Uint8Array;
    counter: number;
    transports: string[];
    deviceType: string;
    backedUp: boolean;
    name: string;
    createdAt: Date;
    lastUsedAt: Date | null;
}

const COLUMNS =
    'id, user_id, credential_id, public_key, counter, transports, device_type, backed_up, name, created_at, last_used_at';

function toPasskey(row: DatabaseRow): Passkey {
    return {
        id: row.id as string,
        userId: row.user_id as string,
        credentialId: row.credential_id as string,
        publicKey: new Uint8Array(row.public_key as Buffer),
        counter: Number(row.counter),
        transports: row.transports as string[],
        deviceType: row.device_type as string,
        backedUp: row.backed_up as boolean,
        name: row.name as string,
        createdAt: row.created_at as Date,
        lastUsedAt: row.last_used_at as Date | null,
    };
}

export const passkeyRepository = {
    async listByUser(userId: string, db: Queryable = getPool()): Promise<Passkey[]> {
        const { rows } = await db.query(
            `SELECT ${COLUMNS} FROM passkeys WHERE user_id = $1 ORDER BY created_at`,
            [userId],
        );
        return rows.map(toPasskey);
    },

    async findByCredentialId(
        credentialId: string,
        db: Queryable = getPool(),
    ): Promise<Passkey | null> {
        const { rows } = await db.query(
            `SELECT ${COLUMNS} FROM passkeys WHERE credential_id = $1`,
            [credentialId],
        );
        return rows[0] ? toPasskey(rows[0]) : null;
    },

    async create(
        input: Omit<Passkey, 'id' | 'createdAt' | 'lastUsedAt'>,
        db: Queryable = getPool(),
    ): Promise<Passkey> {
        const { rows } = await db.query(
            `INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLUMNS}`,
            [
                input.userId,
                input.credentialId,
                Buffer.from(input.publicKey),
                input.counter,
                input.transports,
                input.deviceType,
                input.backedUp,
                input.name,
            ],
        );
        return toPasskey(rows[0] as DatabaseRow);
    },

    /** Records a use: the counter some authenticators advance, and when. */
    async touch(id: string, counter: number, db: Queryable = getPool()): Promise<void> {
        await db.query('UPDATE passkeys SET counter = $2, last_used_at = now() WHERE id = $1', [
            id,
            counter,
        ]);
    },

    /** @returns Whether a passkey of that user was removed. */
    async remove(userId: string, id: string, db: Queryable = getPool()): Promise<boolean> {
        const { rowCount } = await db.query('DELETE FROM passkeys WHERE id = $1 AND user_id = $2', [
            id,
            userId,
        ]);
        return (rowCount ?? 0) > 0;
    },

    async saveChallenge(
        challenge: string,
        purpose: 'register' | 'login',
        userId: string | null,
        ttlSeconds: number,
        db: Queryable = getPool(),
    ): Promise<string> {
        // Expired ceremonies are swept on the way in, so the table cannot grow.
        await db.query('DELETE FROM webauthn_challenges WHERE expires_at < now()');
        const { rows } = await db.query(
            `INSERT INTO webauthn_challenges (challenge, purpose, user_id, expires_at)
             VALUES ($1, $2, $3, now() + make_interval(secs => $4)) RETURNING id`,
            [challenge, purpose, userId, ttlSeconds],
        );
        return (rows[0] as DatabaseRow).id as string;
    },

    /** Takes a challenge exactly once: a replayed response finds nothing. */
    async takeChallenge(
        id: string,
        purpose: 'register' | 'login',
        db: Queryable = getPool(),
    ): Promise<{ challenge: string; userId: string | null } | null> {
        const { rows } = await db.query(
            `DELETE FROM webauthn_challenges
             WHERE id = $1 AND purpose = $2 AND expires_at > now()
             RETURNING challenge, user_id`,
            [id, purpose],
        );
        const row = rows[0];
        return row
            ? { challenge: row.challenge as string, userId: row.user_id as string | null }
            : null;
    },
};
