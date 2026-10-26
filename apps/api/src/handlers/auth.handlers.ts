import type { Request, Response } from 'express';

import { asyncHandler, UnauthorizedError } from '../lib/errors.ts';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../lib/refresh-cookie.ts';
import { toAccount } from '../lib/account-view.ts';
import { configuredProviders } from '../lib/oauth-providers.ts';
import { authService } from '../services/auth-service.ts';
import type { SessionTokens } from '../services/auth-service.ts';

function respond(res: Response, tokens: SessionTokens, status = 200): void {
    setRefreshCookie(res, tokens.refreshToken);
    // The refresh token travels only in the HttpOnly cookie, never in the body.
    res.status(status).json({ accessToken: tokens.accessToken, user: toAccount(tokens.user) });
}

const agent = (req: Request): string | null => req.header('user-agent')?.slice(0, 200) ?? null;

export const register = asyncHandler(async (req, res) => {
    const { username, password, displayName } = req.body as {
        username: string;
        password: string;
        displayName?: string;
    };
    respond(
        res,
        await authService.register(username, password, displayName ?? username, agent(req)),
        201,
    );
});

export const login = asyncHandler(async (req, res) => {
    const { username, password } = req.body as { username: string; password: string };
    respond(res, await authService.login(username, password, agent(req)));
});

export const refresh = asyncHandler(async (req, res) => {
    const token = readRefreshCookie(req);
    if (!token) throw new UnauthorizedError('No session.');
    try {
        respond(res, await authService.refresh(token));
    } catch (error) {
        clearRefreshCookie(res);
        throw error;
    }
});

export const logout = asyncHandler(async (req, res) => {
    if (req.user) await authService.logout(req.user.sid);
    clearRefreshCookie(res);
    res.status(204).end();
});

export const changePassword = asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as {
        currentPassword?: string;
        newPassword: string;
    };
    await authService.changePassword(
        (req.user as { sub: string }).sub,
        currentPassword ?? null,
        newPassword,
    );
    clearRefreshCookie(res);
    res.status(204).end();
});

/** Which "log in with ..." buttons the login page should show. */
export const providers = asyncHandler(async (_req, res) => {
    res.json({ providers: configuredProviders() });
});
