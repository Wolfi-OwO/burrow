import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
    AuthenticationResponseJSON,
    AuthenticatorTransport,
    RegistrationResponseJSON,
} from '@simplewebauthn/server';

import { config } from '../config/index.ts';
import { BadRequestError, ConflictError, NotFoundError, UnauthorizedError } from '../lib/errors.ts';
import { passkeyRepository } from '../repository/passkey.repository.ts';
import type { Passkey } from '../repository/passkey.repository.ts';
import { userRepository } from '../repository/user.repository.ts';
import { authService } from './auth-service.ts';
import type { SessionTokens } from './auth-service.ts';

/** How long a ceremony may take between the options and the answer. */
const CEREMONY_SECONDS = 300;
const RP_NAME = 'burrow';
/** One account may hold this many, so the list stays readable and the table cannot be filled by one login. */
const MAX_PER_USER = 10;

/**
 * The origin a passkey is bound to. It is taken from the deployment's own list of allowed origins, never from the
 * request's Host header, so a forged header cannot name a different site.
 *
 * @param requestOrigin - The browser's Origin header, when it is one of ours.
 */
function bindingOrigin(requestOrigin: string | undefined): { origin: string; rpID: string } {
    const own = config.corsAllowedOrigins;
    const origin = requestOrigin && own.includes(requestOrigin) ? requestOrigin : own[0];
    if (!origin) throw new BadRequestError('Passkeys need CORS_ALLOWED_ORIGINS to name this site.');
    return { origin, rpID: new URL(origin).hostname };
}

export interface PasskeyView {
    id: string;
    name: string;
    createdAt: Date;
    lastUsedAt: Date | null;
    backedUp: boolean;
}

const view = (p: Passkey): PasskeyView => ({
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    lastUsedAt: p.lastUsedAt,
    backedUp: p.backedUp,
});

export const passkeyService = {
    async list(userId: string): Promise<PasskeyView[]> {
        return (await passkeyRepository.listByUser(userId)).map(view);
    },

    async remove(userId: string, id: string): Promise<void> {
        if (!(await passkeyRepository.remove(userId, id))) throw new NotFoundError();
    },

    /** The options a signed-in user's browser needs to create a passkey, and the id of the ceremony. */
    async registrationOptions(userId: string, requestOrigin: string | undefined) {
        const user = await userRepository.findById(userId);
        if (!user) throw new UnauthorizedError();
        const existing = await passkeyRepository.listByUser(userId);
        if (existing.length >= MAX_PER_USER)
            throw new ConflictError(`An account can hold ${String(MAX_PER_USER)} passkeys.`);
        const { rpID } = bindingOrigin(requestOrigin);
        const options = await generateRegistrationOptions({
            rpName: RP_NAME,
            rpID,
            userName: user.username,
            userDisplayName: user.displayName,
            userID: new TextEncoder().encode(user.id),
            attestationType: 'none',
            excludeCredentials: existing.map((p) => ({
                id: p.credentialId,
                transports: p.transports as AuthenticatorTransport[],
            })),
            authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
        });
        const ceremonyId = await passkeyRepository.saveChallenge(
            options.challenge,
            'register',
            userId,
            CEREMONY_SECONDS,
        );
        return { ceremonyId, options };
    },

    async finishRegistration(
        userId: string,
        ceremonyId: string,
        name: string,
        response: RegistrationResponseJSON,
        requestOrigin: string | undefined,
    ): Promise<PasskeyView> {
        const taken = await passkeyRepository.takeChallenge(ceremonyId, 'register');
        if (!taken || taken.userId !== userId)
            throw new BadRequestError('That passkey request has expired. Start again.');
        const { origin, rpID } = bindingOrigin(requestOrigin);
        const result = await verifyRegistrationResponse({
            response,
            expectedChallenge: taken.challenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            requireUserVerification: false,
        }).catch(() => null);
        if (!result?.verified) throw new BadRequestError('The passkey could not be verified.');
        const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
        if (await passkeyRepository.findByCredentialId(credential.id))
            throw new ConflictError('That passkey is already registered.');
        const saved = await passkeyRepository.create({
            userId,
            credentialId: credential.id,
            publicKey: credential.publicKey,
            counter: credential.counter,
            transports: credential.transports ?? [],
            deviceType: credentialDeviceType,
            backedUp: credentialBackedUp,
            name: name.trim() || 'Passkey',
        });
        return view(saved);
    },

    /** Options for signing in without a username: the browser offers the passkeys it holds for this site. */
    async authenticationOptions(requestOrigin: string | undefined) {
        const { rpID } = bindingOrigin(requestOrigin);
        const options = await generateAuthenticationOptions({
            rpID,
            userVerification: 'preferred',
        });
        const ceremonyId = await passkeyRepository.saveChallenge(
            options.challenge,
            'login',
            null,
            CEREMONY_SECONDS,
        );
        return { ceremonyId, options };
    },

    /** @throws {UnauthorizedError} For anything wrong with the answer, with one message. */
    async finishAuthentication(
        ceremonyId: string,
        response: AuthenticationResponseJSON,
        requestOrigin: string | undefined,
        userAgent: string | null,
    ): Promise<SessionTokens> {
        const refuse = (): never => {
            throw new UnauthorizedError('That passkey could not be used.');
        };
        const taken = await passkeyRepository.takeChallenge(ceremonyId, 'login');
        if (!taken) return refuse();
        const stored = await passkeyRepository.findByCredentialId(response.id);
        if (!stored) return refuse();
        const { origin, rpID } = bindingOrigin(requestOrigin);
        const result = await verifyAuthenticationResponse({
            response,
            expectedChallenge: taken.challenge,
            expectedOrigin: origin,
            expectedRPID: rpID,
            credential: {
                id: stored.credentialId,
                publicKey: new Uint8Array(stored.publicKey),
                counter: stored.counter,
                transports: stored.transports,
            },
            requireUserVerification: false,
        }).catch(() => null);
        if (!result?.verified) return refuse();
        const user = await userRepository.findById(stored.userId);
        if (!user) return refuse();
        await passkeyRepository.touch(stored.id, result.authenticationInfo.newCounter);
        return authService.startSessionFor(user, userAgent);
    },
};
