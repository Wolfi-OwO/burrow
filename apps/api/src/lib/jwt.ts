import jwt from 'jsonwebtoken';

import { config } from '../config/index.ts';

/** A registered account role, as embedded in an {@link AccessTokenPayload}. */
export type Role = 'user' | 'admin';

const ROLES: readonly Role[] = ['user', 'admin'];

/**
 * Pinned on both sign and verify, so a later second key type cannot make
 * `verify` accept another algorithm family (the HS/RS confusion shape).
 */
const ALGORITHM = 'HS256';

/** The claims carried in every access token this API issues. */
export interface AccessTokenPayload {
    /** The authenticated user's id. */
    sub: string;
    /** The session row this token belongs to; revoking it ends the token at once. */
    sid: string;
    role: Role;
}

/**
 * Signs an access token for an authenticated session.
 *
 * @param payload - The claims to embed.
 * @returns A signed JWT, expiring after `config.jwtExpiresIn`.
 */
export function signAccessToken(payload: AccessTokenPayload): string {
    return jwt.sign(payload, config.jwtSecret as string, {
        algorithm: ALGORITHM,
        expiresIn: config.jwtExpiresIn as NonNullable<jwt.SignOptions['expiresIn']>,
    });
}

/**
 * Verifies an access token's signature and expiry.
 *
 * @param token - The raw JWT, without the `Bearer ` prefix.
 * @returns The validated claims.
 * @throws {Error} If the signature or expiry is invalid, or the payload is not the shape this API issues.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
    const decoded = jwt.verify(token, config.jwtSecret as string, { algorithms: [ALGORITHM] });

    if (
        typeof decoded === 'string' ||
        typeof decoded.sub !== 'string' ||
        typeof decoded.sid !== 'string' ||
        !ROLES.includes(decoded.role as Role)
    ) {
        throw new Error('Token payload is not a valid access token.');
    }

    return { sub: decoded.sub, sid: decoded.sid, role: decoded.role as Role };
}
