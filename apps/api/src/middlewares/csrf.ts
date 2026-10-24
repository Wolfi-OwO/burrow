import type { NextFunction, Request, Response } from 'express';

import { ForbiddenError } from '../lib/errors.ts';

/**
 * The refresh cookie rides along automatically, so the routes that use it demand a header a cross-site page
 * cannot send without a CORS preflight (which the origin allow-list refuses). SameSite=Strict already blocks
 * the cookie on cross-site requests; this is the second, independent layer.
 */
export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction): void {
    if (req.header('x-requested-with') !== 'burrow') {
        next(new ForbiddenError('Missing X-Requested-With header.'));
        return;
    }
    next();
}
