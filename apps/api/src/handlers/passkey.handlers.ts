import type { Request, Response } from 'express';

import { asyncHandler } from '../lib/errors.ts';
import { toAccount } from '../lib/account-view.ts';
import { setRefreshCookie } from '../lib/refresh-cookie.ts';
import { passkeyService } from '../services/passkey-service.ts';
import type { SessionTokens } from '../services/auth-service.ts';

const uid = (req: Request): string => (req.user as { sub: string }).sub;
const origin = (req: Request): string | undefined => req.header('origin') ?? undefined;
const agent = (req: Request): string | null => req.header('user-agent')?.slice(0, 200) ?? null;

function respond(res: Response, tokens: SessionTokens): void {
    setRefreshCookie(res, tokens.refreshToken);
    res.json({ accessToken: tokens.accessToken, user: toAccount(tokens.user) });
}

export const list = asyncHandler(async (req, res) => {
    res.json({ passkeys: await passkeyService.list(uid(req)) });
});

export const remove = asyncHandler(async (req, res) => {
    await passkeyService.remove(uid(req), req.params.id as string);
    res.status(204).end();
});

export const registrationOptions = asyncHandler(async (req, res) => {
    res.json(await passkeyService.registrationOptions(uid(req), origin(req)));
});

export const finishRegistration = asyncHandler(async (req, res) => {
    const { ceremonyId, name, response } = req.body as {
        ceremonyId: string;
        name: string;
        response: Parameters<typeof passkeyService.finishRegistration>[3];
    };
    res.status(201).json({
        passkey: await passkeyService.finishRegistration(
            uid(req),
            ceremonyId,
            name,
            response,
            origin(req),
        ),
    });
});

export const authenticationOptions = asyncHandler(async (req, res) => {
    res.json(await passkeyService.authenticationOptions(origin(req)));
});

export const finishAuthentication = asyncHandler(async (req, res) => {
    const { ceremonyId, response } = req.body as {
        ceremonyId: string;
        response: Parameters<typeof passkeyService.finishAuthentication>[1];
    };
    respond(
        res,
        await passkeyService.finishAuthentication(ceremonyId, response, origin(req), agent(req)),
    );
});
