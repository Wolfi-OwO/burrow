// OAuth — a hand-rolled Authorization Code flow rather than a
// framework (passport.js et al pull in a strategy package per provider and a
// session-middleware dependency this stateless-JWT API doesn't otherwise
// need). Each provider's shape (authorize URL, token exchange, profile
// fetch, and how to read a verified email out of its specific response) is
// different enough that a thin adapter per provider is clearer than a
// one-size-fits-all abstraction forcing them into the same shape.

import { config } from '../config/index.ts';
import type { Provider as OAuthProviderName } from '../models/user.model.ts';

export interface OAuthProfile {
    /** The provider's own stable account id — never the email (see auth-provider.repository.ts). */
    providerUserId: string;
    email: string | null;
    /** Only a *verified* email is safe to use for account linking (see oauth-service.ts). */
    emailVerified: boolean;
    displayName: string;
    /**
     * The provider's own hosted avatar image URL (GitHub's `avatar_url`,
     * Google's `picture` claim) — `null` when the provider's profile
     * response has no such field, as with Microsoft's OIDC userinfo (a
     * photo there only exists via `fetchAvatarImage`, below).
     */
    pictureUrl: string | null;
}

interface OAuthProviderAdapter {
    clientId: string | undefined;
    clientSecret: string | undefined;
    scope: string;
    authorizeUrl: string;
    buildAuthorizeParams: (redirectUri: string, state: string) => Record<string, string>;
    exchangeCode: (code: string, redirectUri: string) => Promise<string>;
    fetchProfile: (accessToken: string) => Promise<OAuthProfile>;
    /**
     * Best-effort binary photo fetch for providers with no public avatar
     * URL in their profile response. Only `microsoft` implements this
     * (Microsoft Graph's `/me/photo/$value`) — the caller
     * (`OAuthService#captureProviderAvatar`) treats a missing
     * implementation and a `null` result identically: no photo captured,
     * login proceeds regardless either way.
     */
    fetchAvatarImage?: (accessToken: string) => Promise<Buffer | null>;
}

/**
 * Every URL fetched in this file is a constant literal below — there is no
 * SSRF surface here, because nothing a user or a provider sends is ever
 * turned into a request target. What was missing was a deadline: a provider
 * that accepts the connection and then stalls held the callback handler,
 * and so the browser mid-login, open indefinitely.
 */
const PROVIDER_TIMEOUT_MS = 5000;

/**
 * Cap on a provider-hosted avatar. Matches the 2MB multer limit on
 * `POST /users/me/avatar` — a photo arriving via Microsoft Graph is stored
 * in the same column as an upload and has no reason to be allowed more.
 */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

async function postForm(
    url: string,
    body: Record<string, string>,
): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
        },
        body: new URLSearchParams(body),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new Error(`Token exchange failed: HTTP ${String(response.status)}`);
    }
    return (await response.json()) as Record<string, unknown>;
}

async function getJson(url: string, accessToken: string): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) {
        throw new Error(`Profile fetch failed: HTTP ${String(response.status)}`);
    }
    return (await response.json()) as Record<string, unknown>;
}

const github: OAuthProviderAdapter = {
    clientId: config.oauth.github.clientId,
    clientSecret: config.oauth.github.clientSecret,
    scope: 'read:user user:email',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    buildAuthorizeParams: (redirectUri, state) => ({
        client_id: github.clientId ?? '',
        redirect_uri: redirectUri,
        scope: github.scope,
        state,
    }),
    exchangeCode: async (code, redirectUri) => {
        const body = await postForm('https://github.com/login/oauth/access_token', {
            client_id: github.clientId ?? '',
            client_secret: github.clientSecret ?? '',
            code,
            redirect_uri: redirectUri,
        });
        if (typeof body.access_token !== 'string') {
            throw new Error('GitHub token response missing access_token.');
        }
        return body.access_token;
    },
    fetchProfile: async (accessToken) => {
        const user = await getJson('https://api.github.com/user', accessToken);
        // GitHub's /user.email is null when the user's email is private —
        // /user/emails (needs the same user:email scope) always has the
        // verified primary, which is what account linking actually needs.
        const emails = (await getJson(
            'https://api.github.com/user/emails',
            accessToken,
        )) as unknown as {
            email: string;
            primary: boolean;
            verified: boolean;
        }[];
        const primary = emails.find((entry) => entry.primary) ?? emails[0];
        return {
            providerUserId: String(user.id),
            email: primary?.email ?? null,
            emailVerified: primary?.verified ?? false,
            displayName:
                typeof user.name === 'string' && user.name.length > 0
                    ? user.name
                    : String(user.login),
            pictureUrl: typeof user.avatar_url === 'string' ? user.avatar_url : null,
        };
    },
};

const google: OAuthProviderAdapter = {
    clientId: config.oauth.google.clientId,
    clientSecret: config.oauth.google.clientSecret,
    scope: 'openid email profile',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    buildAuthorizeParams: (redirectUri, state) => ({
        client_id: google.clientId ?? '',
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: google.scope,
        state,
    }),
    exchangeCode: async (code, redirectUri) => {
        const body = await postForm('https://oauth2.googleapis.com/token', {
            client_id: google.clientId ?? '',
            client_secret: google.clientSecret ?? '',
            code,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        });
        if (typeof body.access_token !== 'string') {
            throw new Error('Google token response missing access_token.');
        }
        return body.access_token;
    },
    fetchProfile: async (accessToken) => {
        const profile = await getJson(
            'https://openidconnect.googleapis.com/v1/userinfo',
            accessToken,
        );
        const email = typeof profile.email === 'string' ? profile.email : null;
        return {
            providerUserId: String(profile.sub),
            email,
            emailVerified: profile.email_verified === true,
            displayName: typeof profile.name === 'string' ? profile.name : (email ?? 'Google user'),
            pictureUrl: typeof profile.picture === 'string' ? profile.picture : null,
        };
    },
};

const microsoft: OAuthProviderAdapter = {
    clientId: config.oauth.microsoft.clientId,
    clientSecret: config.oauth.microsoft.clientSecret,
    scope: 'openid email profile',
    // "common" tenant: accepts both personal Microsoft accounts and work/school
    // accounts — the right default for a consumer-facing app with no
    // organizational-tenant restriction.
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    buildAuthorizeParams: (redirectUri, state) => ({
        client_id: microsoft.clientId ?? '',
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: microsoft.scope,
        state,
    }),
    exchangeCode: async (code, redirectUri) => {
        const body = await postForm('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
            client_id: microsoft.clientId ?? '',
            client_secret: microsoft.clientSecret ?? '',
            code,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        });
        if (typeof body.access_token !== 'string') {
            throw new Error('Microsoft token response missing access_token.');
        }
        return body.access_token;
    },
    fetchProfile: async (accessToken) => {
        const profile = await getJson('https://graph.microsoft.com/oidc/userinfo', accessToken);
        const email = typeof profile.email === 'string' ? profile.email : null;
        return {
            providerUserId: String(profile.sub),
            // Microsoft's OIDC userinfo doesn't expose an explicit
            // email_verified claim; a Microsoft account's primary email is
            // verified by definition (it's the sign-in identifier itself),
            // unlike GitHub/Google where a secondary, unverified address
            // could otherwise be attached.
            email,
            emailVerified: email !== null,
            displayName:
                typeof profile.name === 'string' ? profile.name : (email ?? 'Microsoft user'),
            // Microsoft's OIDC userinfo has no picture claim — a real photo
            // only exists via fetchAvatarImage's separate Graph call, below.
            pictureUrl: null,
        };
    },
    // Best-effort: personal Microsoft accounts frequently have no photo, in
    // which case this 404s — that's an expected outcome, not an error, so a
    // non-ok response returns null rather than throwing. See
    // OAuthService#captureProviderAvatar for how a null/thrown result here
    // is guaranteed to never break login.
    fetchAvatarImage: async (accessToken) => {
        try {
            const response = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
                headers: { Authorization: `Bearer ${accessToken}` },
                signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
            });
            if (!response.ok) return null;
            // Graph answers a missing photo with a JSON error body under a
            // 200 in some tenants, so the status alone doesn't say "this is
            // an image".
            if (!response.headers.get('content-type')?.startsWith('image/')) return null;
            // Content-Length first so an over-sized photo is dropped before
            // it's buffered; the byteLength check behind it covers a
            // chunked response that declares no length. Both bound what is
            // already a fixed, trusted host — a streaming cap would only
            // matter if the target were attacker-chosen, which it isn't.
            const declaredLength = Number(response.headers.get('content-length'));
            if (Number.isFinite(declaredLength) && declaredLength > MAX_AVATAR_BYTES) return null;
            const bytes = Buffer.from(await response.arrayBuffer());
            return bytes.byteLength > MAX_AVATAR_BYTES ? null : bytes;
        } catch {
            return null;
        }
    },
};

const PROVIDERS: Record<OAuthProviderName, OAuthProviderAdapter> = { github, google, microsoft };

export function getProvider(name: OAuthProviderName): OAuthProviderAdapter {
    return PROVIDERS[name];
}

export function isProviderConfigured(name: OAuthProviderName): boolean {
    const provider = PROVIDERS[name];
    return Boolean(provider.clientId && provider.clientSecret);
}

export function configuredProviders(): OAuthProviderName[] {
    return (Object.keys(PROVIDERS) as OAuthProviderName[]).filter(isProviderConfigured);
}

export function buildAuthorizeUrl(
    name: OAuthProviderName,
    redirectUri: string,
    state: string,
): string {
    const provider = getProvider(name);
    const params = new URLSearchParams(provider.buildAuthorizeParams(redirectUri, state));
    return `${provider.authorizeUrl}?${params.toString()}`;
}
