import type { NextFunction, Request, Response } from 'express';
import type { ZodError, ZodType } from 'zod';

import type { FieldIssue } from '../lib/errors.ts';
import { NotFoundError, ValidationError } from '../lib/errors.ts';
import { idParamSchema } from '../schemas/params.schemas.ts';

/**
 * @param error - The failed parse's error.
 * @returns One {@link FieldIssue} per zod issue, dot-joining the path so a
 *   nested field reads as `items.0.foodName` rather than a raw array.
 */
function toFieldIssues(error: ZodError): FieldIssue[] {
    return error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
    }));
}

/**
 * Validates `req.body` against `schema`, replacing it with the parsed
 * (and thus now-typed) result on success. Mount ahead of a handler so the
 * handler can trust its shape instead of re-checking it —'s "no
 * endpoint trusts unvalidated input".
 *
 * @param schema - The schema the request body must satisfy.
 * @returns Middleware that forwards a {@link ValidationError} on failure.
 */
export function validateBody<T>(schema: ZodType<T>) {
    return function validate(req: Request, _res: Response, next: NextFunction): void {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            next(new ValidationError(toFieldIssues(result.error)));
            return;
        }
        req.body = result.data;
        next();
    };
}

/**
 * Validates `req.query` against `schema`, replacing it with the parsed
 * result on success.
 *
 * @param schema - The schema the query string must satisfy.
 * @returns Middleware that forwards a {@link ValidationError} on failure.
 */
export function validateQuery<T>(schema: ZodType<T>) {
    return function validate(req: Request, _res: Response, next: NextFunction): void {
        const result = schema.safeParse(req.query);
        if (!result.success) {
            next(new ValidationError(toFieldIssues(result.error)));
            return;
        }
        req.query = result.data as Request['query'];
        next();
    };
}

/**
 * Validates `req.params.id` as a UUID before a handler passes it to the
 * database. Rejects with {@link NotFoundError} (404), not
 * {@link ValidationError} (400) — a malformed id must read identically to a
 * well-formed one that simply doesn't exist (see schemas/params.schemas.ts),
 * the same "don't let a bad input distinguish itself from a missing record"
 * principle applied everywhere else lookups happen by id in this API.
 * Without this, a malformed id reached Postgres, which threw SQLSTATE 22P02
 * ("invalid input syntax for type uuid") and fell through to a 500 — leaking
 * the raw driver message outside production, on routes including the
 * unauthenticated `GET /users/:id/avatar`.
 *
 * @returns Middleware that forwards a {@link NotFoundError} on a malformed id.
 */
export function validateIdParam() {
    return function validate(req: Request, _res: Response, next: NextFunction): void {
        const result = idParamSchema.safeParse(req.params);
        if (!result.success) {
            next(new NotFoundError());
            return;
        }
        req.params = result.data;
        next();
    };
}
