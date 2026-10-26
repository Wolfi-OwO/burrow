import argon2 from 'argon2';

import { config } from '../config/index.ts';
import { getPool } from '../database/connection.ts';
import { ConflictError, ForbiddenError, UnauthorizedError } from '../lib/errors.ts';
import { signAccessToken } from '../lib/jwt.ts';
import type { User } from '../models/user.model.ts';
import { sessionRepository } from '../repository/session.repository.ts';
import { userRepository } from '../repository/user.repository.ts';

/**
 * Argon2id with the OWASP-recommended floor (19 MiB, 2 passes, 1 lane) — reviewed, not the library
 * defaults (FR-001). Raise memoryCost before lowering anything.
 */
const ARGON2_OPTIONS = {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
} as const;

/** Verified against when the username does not exist, so a miss costs as much as a wrong password. */
const DUMMY_HASH = await argon2.hash('burrow-dummy-password', ARGON2_OPTIONS);

/** The pair a successful login hands out. */
export interface SessionTokens {
    accessToken: string;
    refreshToken: string;
    user: User;
}

/**
 * @param password - A plaintext password.
 * @returns Its Argon2id hash.
 */
export function hashPassword(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
}

async function startSession(user: User, userAgent: string | null): Promise<SessionTokens> {
    const { session, refreshToken } = await sessionRepository.create(
        user.id,
        config.refreshTokenTtlDays,
        userAgent,
    );
    return {
        accessToken: signAccessToken({ sub: user.id, sid: session.id, role: user.role }),
        refreshToken,
        user,
    };
}

export const authService = {
    /**
     * Creates the first account (the owner, an admin). Later accounts need REGISTRATION_OPEN=true.
     *
     * @throws {ForbiddenError} When registration is closed.
     * @throws {ConflictError} When the username is taken.
     */
    async register(
        username: string,
        password: string,
        displayName: string,
        userAgent: string | null,
    ): Promise<SessionTokens> {
        const existing = await userRepository.count();
        if (existing > 0 && !config.registrationOpen)
            throw new ForbiddenError('Registration is closed.');
        if (await userRepository.findByUsername(username))
            throw new ConflictError('That username is taken.');

        const user = await userRepository.create({
            username,
            passwordHash: await hashPassword(password),
            displayName,
            role: existing === 0 ? 'admin' : 'user',
        });
        return startSession(user, userAgent);
    },

    /**
     * @throws {UnauthorizedError} For an unknown user, a wrong password, or an OIDC-only account — all with the
     *   same message, so the response never says which accounts exist. Passwords are never logged (FR-003).
     */
    async login(
        username: string,
        password: string,
        userAgent: string | null,
    ): Promise<SessionTokens> {
        const user = await userRepository.findByUsername(username);
        const ok = await argon2.verify(user?.passwordHash ?? DUMMY_HASH, password);
        if (!user || !user.passwordHash || !ok)
            throw new UnauthorizedError('Invalid username or password.');
        return startSession(user, userAgent);
    },

    /** Opens a session for a user who authenticated some other way (OIDC). */
    startSessionFor(user: User, userAgent: string | null): Promise<SessionTokens> {
        return startSession(user, userAgent);
    },

    /**
     * Exchanges a refresh token for a new access token and rotates the refresh token, so a leaked one
     * works at most once before the rightful owner's next refresh invalidates it.
     *
     * @throws {UnauthorizedError} When the token is unknown, expired or revoked.
     */
    async refresh(refreshToken: string): Promise<SessionTokens> {
        const session = await sessionRepository.findLiveByRefreshToken(refreshToken);
        const user = session ? await userRepository.findById(session.userId) : null;
        if (!session || !user) throw new UnauthorizedError('Session expired.');

        const rotated = await sessionRepository.rotate(session.id, config.refreshTokenTtlDays);
        return {
            accessToken: signAccessToken({ sub: user.id, sid: session.id, role: user.role }),
            refreshToken: rotated,
            user,
        };
    },

    /** Revokes the session, ending it now rather than when the JWT expires (FR-005). */
    async logout(sessionId: string): Promise<void> {
        await sessionRepository.revoke(sessionId);
    },

    /**
     * Sets the password of the caller after checking the current one (an OIDC-only account may set its first).
     *
     * @throws {UnauthorizedError} When the current password is wrong.
     */
    async changePassword(userId: string, current: string | null, next: string): Promise<void> {
        const user = await userRepository.findById(userId);
        if (!user) throw new UnauthorizedError();
        if (user.passwordHash && !(current && (await argon2.verify(user.passwordHash, current)))) {
            throw new UnauthorizedError('The current password is wrong.');
        }
        await getPool().transaction(async (tx) => {
            await userRepository.setPasswordHash(userId, await hashPassword(next), tx);
            // A password change ends every other session; the caller logs in again on the next refresh failure.
            await sessionRepository.revokeAll(userId, tx);
        });
    },
};
