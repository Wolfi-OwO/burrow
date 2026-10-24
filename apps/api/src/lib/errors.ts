import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Global HTTP error classes. Throw these anywhere — the central error handler
// turns them into the right status code + JSON body.

export class AppError extends Error {
    readonly statusCode: number;
    /** Whether the message is safe to send to the client (4xx) vs hidden in prod (5xx). */
    readonly expose: boolean;

    /**
     * @param statusCode - The HTTP status code to respond with.
     * @param message - The error message.
     * @param expose - Whether `message` is safe to send to the client.
     *   Defaults to `true` for 4xx, `false` for 5xx.
     */
    public constructor(statusCode: number, message: string, expose = statusCode < 500) {
        super(message);
        this.name = new.target.name;
        this.statusCode = statusCode;
        this.expose = expose;
        Error.captureStackTrace?.(this, new.target);
    }
}

// ── 4xx — client errors ────────────────────────────────────────────────────

export class BadRequestError extends AppError {
    public constructor(message = 'Bad Request') {
        super(400, message);
    }
}
export class UnauthorizedError extends AppError {
    public constructor(message = 'Unauthorized') {
        super(401, message);
    }
}
export class ForbiddenError extends AppError {
    public constructor(message = 'Forbidden') {
        super(403, message);
    }
}
export class NotFoundError extends AppError {
    public constructor(message = 'Not Found') {
        super(404, message);
    }
}
export class ConflictError extends AppError {
    public constructor(message = 'Conflict') {
        super(409, message);
    }
}
export class ServiceUnavailableError extends AppError {
    public constructor(message = 'Service Unavailable') {
        super(503, message);
    }
}

/** A single field-level validation failure. */
export interface FieldIssue {
    /** Dot-separated path into the request body/query, e.g. `items.0.foodName`. */
    path: string;
    message: string;
}

/**
 * Raised by the `validate*` middlewares (see `middlewares/validate.ts`) when
 * a request fails schema validation. Carries structured, per-field detail —
 * `errorHandler` includes `issues` in the response body for exactly this
 * error type, everything else just gets `message`.
 */
export class ValidationError extends BadRequestError {
    readonly issues: FieldIssue[];

    /** @param issues - The fields that failed validation, and why. */
    public constructor(issues: FieldIssue[]) {
        super('Validation failed.');
        this.issues = issues;
    }
}

// ── 5xx — server errors ────────────────────────────────────────────────────

export class InternalServerError extends AppError {
    public constructor(message = 'Internal Server Error') {
        super(500, message, false);
    }
}

/**
 * Wrap a route handler so rejected promises (and thrown errors) reach the
 * error handler. Works for both sync and async handlers.
 *
 * @param fn - The handler to wrap.
 * @returns An Express-compatible handler that forwards failures to `next`.
 */
export function asyncHandler(
    fn: (req: Request, res: Response, next: NextFunction) => unknown,
): RequestHandler {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
