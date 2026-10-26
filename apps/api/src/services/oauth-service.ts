import { config } from '../config/index.ts';
import { getPool } from '../database/connection.ts';
import { BadRequestError, ConflictError, ForbiddenError } from '../lib/errors.ts';
import type { OAuthProfile } from '../lib/oauth-providers.ts';
import type { Provider, User, UserIdentity } from '../models/user.model.ts';
import { identityRepository } from '../repository/identity.repository.ts';
import { userRepository } from '../repository/user.repository.ts';

const UNIQUE_VIOLATION = '23505';

/**
 * @param profile - What the provider told us.
 * @returns A free-looking username from the email or the display name, made unique by the caller.
 */
function usernameBase(profile: OAuthProfile): string {
    const raw = (profile.email?.split('@')[0] ?? profile.displayName).toLowerCase();
    const slug = raw
        .replaceAll(/[^a-z0-9._-]+/g, '-')
        .replaceAll(/^-+|-+$/g, '')
        .slice(0, 24);
    return slug.length >= 3 ? slug : `user-${slug || 'x'}`;
}

async function freeUsername(profile: OAuthProfile): Promise<string> {
    const base = usernameBase(profile);
    for (let i = 0; i < 50; i++) {
        const candidate = i === 0 ? base : `${base}-${String(i + 1)}`;
        if (!(await userRepository.findByUsername(candidate))) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
}

export const oauthService = {
    /**
     * Logs a provider account in (FR-006 to FR-008, one code path for all three providers): an existing
     * link wins; otherwise a VERIFIED email matching a linked identity links to that account; otherwise a
     * new account is created, which only the first account or an open registration may do.
     *
     * @throws {BadRequestError} When the provider shares no email.
     * @throws {ForbiddenError} When a new account is needed but registration is closed.
     */
    async resolveLogin(provider: Provider, profile: OAuthProfile): Promise<User> {
        const link = await identityRepository.find(provider, profile.providerUserId);
        if (link) {
            const user = await userRepository.findById(link.userId);
            if (!user) throw new Error('Identity references a deleted user.');
            return user;
        }

        if (!profile.email) {
            throw new BadRequestError(
                `Your ${provider} account shares no email address, so burrow cannot match or create an account.`,
            );
        }

        if (profile.emailVerified) {
            const existingId = await identityRepository.findUserIdByVerifiedEmail(profile.email);
            const existing = existingId ? await userRepository.findById(existingId) : null;
            if (existing) {
                await identityRepository.create({
                    userId: existing.id,
                    provider,
                    providerUserId: profile.providerUserId,
                    email: profile.email,
                    emailVerified: true,
                });
                return existing;
            }
        }

        const accounts = await userRepository.count();
        if (accounts > 0 && !config.registrationOpen)
            throw new ForbiddenError('Registration is closed.');

        return getPool().transaction(async (tx) => {
            const user = await userRepository.create(
                {
                    username: await freeUsername(profile),
                    passwordHash: null,
                    displayName: profile.displayName,
                    role: accounts === 0 ? 'admin' : 'user',
                },
                tx,
            );
            await identityRepository.create(
                {
                    userId: user.id,
                    provider,
                    providerUserId: profile.providerUserId,
                    email: profile.email,
                    emailVerified: profile.emailVerified,
                },
                tx,
            );
            return user;
        });
    },

    /**
     * Links another provider to the signed-in user (FR-009). An unverified email is refused: it would let
     * someone claim an address they do not own.
     *
     * @throws {BadRequestError} When the provider's email is not verified.
     * @throws {ConflictError} When that provider account already belongs to someone.
     */
    async link(userId: string, provider: Provider, profile: OAuthProfile): Promise<void> {
        if (!profile.email || !profile.emailVerified) {
            throw new BadRequestError(
                `${provider} did not confirm your email address, so it cannot be linked.`,
            );
        }
        const existing = await identityRepository.find(provider, profile.providerUserId);
        if (existing) {
            if (existing.userId === userId) return;
            throw new ConflictError('That account is already linked to another burrow user.');
        }
        try {
            await identityRepository.create({
                userId,
                provider,
                providerUserId: profile.providerUserId,
                email: profile.email,
                emailVerified: true,
            });
        } catch (error) {
            if ((error as { code?: string }).code === UNIQUE_VIOLATION)
                throw new ConflictError(`A ${provider} account is already linked to you.`);
            throw error;
        }
    },

    /** @returns The providers linked to a user. Emails stay with the owner (FR-019). */
    listIdentities(userId: string): Promise<UserIdentity[]> {
        return identityRepository.listForUser(userId);
    },

    /**
     * Removes a link, provided another way to log in remains (FR-009).
     *
     * @throws {ConflictError} When it is the last login method.
     */
    async unlink(userId: string, provider: Provider): Promise<boolean> {
        const user = await userRepository.findById(userId);
        const identities = await identityRepository.listForUser(userId);
        const remaining =
            identities.filter((i) => i.provider !== provider).length + (user?.passwordHash ? 1 : 0);
        if (remaining === 0)
            throw new ConflictError(
                'That is your only way to log in; add a password or another provider first.',
            );
        return identityRepository.remove(userId, provider);
    },
};
