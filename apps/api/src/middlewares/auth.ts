import type { NextFunction, Request, Response } from 'express';

import { ForbiddenError, UnauthorizedError } from '../lib/errors.ts';
import { verifyAccessToken } from '../lib/jwt.ts';
import { sessionRepository } from '../repository/session.repository.ts';
import type { Role } from '../lib/jwt.ts';

const BEARER_PREFIX = 'Bearer ';

/**
 * Verifies the `Authorization: Bearer <token>` header and attaches the
 * decoded claims to `req.user`. Mount this before any route (or before
 * {@link requireRole}) that needs to know who's calling.
 *
 * @param req - The incoming request.
 * @param _res - Unused; failures are forwarded to the error handler.
 * @param next - Called with no argument on success, or with an {@link UnauthorizedError}.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
    authenticate(req).then(next, next);
}

/**
 * The one shared check behind every protected route (FR-004): a valid token whose session row is still live,
 * so logging out (FR-005) takes effect immediately instead of when the JWT expires.
 */
async function authenticate(req: Request): Promise<void> {
    const header = req.header('authorization');
    if (!header || !header.startsWith(BEARER_PREFIX)) {
        throw new UnauthorizedError('Authentication required.');
    }

    let claims;
    try {
        claims = verifyAccessToken(header.slice(BEARER_PREFIX.length));
    } catch {
        throw new UnauthorizedError('Invalid or expired token.');
    }
    if (!(await sessionRepository.findLive(claims.sid)))
        throw new UnauthorizedError('Session ended.');
    req.user = claims;
}

/**
 * Restricts a route to the given roles. Must be mounted after
 * {@link requireAuth} — it trusts `req.user` rather than re-verifying the
 * token, so a route that skips `requireAuth` fails closed (403, not a
 * crash) rather than granting access.
 *
 * @param roles - The roles allowed through.
 * @returns Middleware that forwards a {@link ForbiddenError} for anyone else.
 */
export function requireRole(...roles: Role[]) {
    return function checkRole(req: Request, _res: Response, next: NextFunction): void {
        if (!req.user || !roles.includes(req.user.role)) {
            next(new ForbiddenError('You do not have permission to perform this action.'));
            return;
        }
        next();
    };
}

/**
 * For routes open to everyone but richer for a signed-in visitor (share links): sets `req.user` when a valid token
 * is sent and carries on without it when none is. A token that is sent but wrong is still a 401, so an expired
 * session is told to sign in again instead of being silently treated as a stranger.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
    if (!req.header('authorization')) {
        next();
        return;
    }
    authenticate(req).then(next, next);
}
