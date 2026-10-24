import type { Request, Response } from 'express';

import { config } from '../config/index.ts';
import { BadRequestError, NotFoundError, asyncHandler } from '../lib/errors.ts';
import { buildAuthorizeUrl, getProvider, isProviderConfigured } from '../lib/oauth-providers.ts';
import { signOAuthState, verifyOAuthState } from '../lib/oauth-state.ts';
import { setRefreshCookie } from '../lib/refresh-cookie.ts';
import type { Provider } from '../models/user.model.ts';
import { authService } from '../services/auth-service.ts';
import { oauthService } from '../services/oauth-service.ts';

const PROVIDER_NAMES: readonly Provider[] = ['github', 'google', 'microsoft'];

function parseProvider(raw: string): Provider {
    if (!PROVIDER_NAMES.includes(raw as Provider))
        throw new NotFoundError(`Unknown provider "${raw}".`);
    if (!isProviderConfigured(raw as Provider))
        throw new NotFoundError(`"${raw}" login is not configured on this deployment.`);
    return raw as Provider;
}

/** Built from the request itself so it works on the real domain, a preview revision and local dev alike. */
function callbackUrl(req: Request, provider: Provider): string {
    return `${req.protocol}://${req.get('host')}/api/auth/${provider}/callback`;
}

/** @returns The browser-facing origin, without trailing slashes (a linear scan: the Host header is untrusted input). */
export function frontendBase(req: Request): string {
    const host = req.get('host');
    const origin = host ? `${req.protocol}://${host}` : (config.oauth.frontendBaseUrl ?? '');
    let end = origin.length;
    while (end > 0 && origin.charCodeAt(end - 1) === 47) end -= 1;
    return origin.slice(0, end);
}

/** `GET /api/auth/:provider` — sends the browser to the provider; `state` is this round trip's CSRF protection. */
export function oauthStart(req: Request, res: Response): void {
    const provider = parseProvider(req.params.provider ?? '');
    res.redirect(buildAuthorizeUrl(provider, callbackUrl(req, provider), signOAuthState(provider)));
}

/** `POST /api/me/identities/:provider/link` — the signed-in user starts linking a provider (FR-009). */
export function linkStart(req: Request, res: Response): void {
    const provider = parseProvider(req.params.provider ?? '');
    const userId = (req.user as { sub: string }).sub;
    res.json({
        url: buildAuthorizeUrl(
            provider,
            callbackUrl(req, provider),
            signOAuthState(provider, userId),
        ),
    });
}

/**
 * `GET /api/auth/:provider/callback` — one handler for login and linking. A browser is mid-redirect, so a
 * failure goes back to the SPA as a message, never as raw JSON.
 */
export const oauthCallback = asyncHandler(async (req, res) => {
    const provider = parseProvider(req.params.provider ?? '');
    const base = frontendBase(req);
    try {
        const { linkUserId } = verifyOAuthState(
            typeof req.query.state === 'string' ? req.query.state : undefined,
            provider,
        );
        const code = req.query.code;
        if (typeof code !== 'string' || code.length === 0)
            throw new BadRequestError('Missing authorization code.');

        const adapter = getProvider(provider);
        const token = await adapter.exchangeCode(code, callbackUrl(req, provider));
        const profile = await adapter.fetchProfile(token);

        if (linkUserId) {
            await oauthService.link(linkUserId, provider, profile);
            res.redirect(`${base}/profile?linked=${provider}`);
            return;
        }
        const user = await oauthService.resolveLogin(provider, profile);
        const tokens = await authService.startSessionFor(
            user,
            req.header('user-agent')?.slice(0, 200) ?? null,
        );
        // The refresh cookie carries the session; the SPA trades it for an access token on load.
        setRefreshCookie(res, tokens.refreshToken);
        res.redirect(`${base}/oauth/callback`);
    } catch (error) {
        const known =
            error instanceof BadRequestError ||
            (error as { statusCode?: number }).statusCode === 403 ||
            (error as { statusCode?: number }).statusCode === 409;
        const message = known ? (error as Error).message : 'Sign-in failed. Please try again.';
        res.redirect(`${base}/login?error=${encodeURIComponent(message)}`);
    }
});

export const listIdentities = asyncHandler(async (req, res) => {
    const identities = await oauthService.listIdentities((req.user as { sub: string }).sub);
    res.json({ identities: identities.map((i) => ({ provider: i.provider, email: i.email })) });
});

export const unlinkIdentity = asyncHandler(async (req, res) => {
    const provider = req.params.provider as Provider;
    if (!PROVIDER_NAMES.includes(provider)) throw new NotFoundError();
    if (!(await oauthService.unlink((req.user as { sub: string }).sub, provider)))
        throw new NotFoundError('That provider is not linked.');
    res.status(204).end();
});
