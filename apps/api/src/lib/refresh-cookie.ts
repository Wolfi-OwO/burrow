import type { Request, Response } from 'express';

import { config, isProduction } from '../config/index.ts';

const NAME = 'burrow_rt';
/** Only the auth routes ever need the cookie. */
const PATH = '/api/auth';

/** Stores the refresh token where scripts cannot read it: HttpOnly, SameSite=Strict, Secure in production. */
export function setRefreshCookie(res: Response, token: string): void {
    res.cookie(NAME, token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: isProduction,
        path: PATH,
        maxAge: config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    });
}

export function clearRefreshCookie(res: Response): void {
    res.clearCookie(NAME, { httpOnly: true, sameSite: 'strict', secure: isProduction, path: PATH });
}

/** @returns The refresh token from the request's Cookie header, or undefined. */
export function readRefreshCookie(req: Request): string | undefined {
    for (const part of (req.header('cookie') ?? '').split(';')) {
        const [key, ...rest] = part.trim().split('=');
        if (key === NAME) return decodeURIComponent(rest.join('='));
    }
    return undefined;
}
