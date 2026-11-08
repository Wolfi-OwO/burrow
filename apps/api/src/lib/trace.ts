import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

/**
 * A trace id follows one request through the whole system: the browser makes it (so it exists even when the server
 * is never reached), the proxy and this server accept it, every log line written while the request is handled
 * carries it, and every response and error message shows it. A person who reports "something went wrong" quotes
 * the 12 characters and the operator finds the full story with one search.
 */
export const TRACE_HEADER = 'X-Trace-Id';

/** What a quotable id looks like. Anything else a client sends is ignored: an id ends up in logs and responses. */
const VALID = /^[A-Za-z0-9._-]{8,64}$/;

const storage = new AsyncLocalStorage<string>();

/** @returns A new id: 12 hex characters, short enough to read out and read back. */
export function newTraceId(): string {
    return randomBytes(6).toString('hex');
}

/** @returns The id the client sent when it is well formed, otherwise a new one. */
export function traceIdFrom(headers: { [key: string]: string | string[] | undefined }): string {
    // x-correlation-id is what older callers sent; both names are read, this one wins.
    for (const name of ['x-trace-id', 'x-correlation-id']) {
        const value = headers[name];
        if (typeof value === 'string' && VALID.test(value)) return value;
    }
    return newTraceId();
}

/** @returns The id of the request being handled right now, or undefined outside of one (start-up, the scheduler). */
export function currentTraceId(): string | undefined {
    return storage.getStore();
}

/** Runs `work` as part of a trace, for background work that starts without a request (and for tests). */
export function withTrace<T>(id: string, work: () => T): T {
    return storage.run(id, work);
}

/** First in the chain: gives the request its id, sends it back, and makes it available to everything downstream. */
export function traceMiddleware(req: Request, res: Response, next: NextFunction): void {
    const id = traceIdFrom(req.headers);
    res.setHeader(TRACE_HEADER, id);
    res.locals.traceId = id;
    storage.run(id, next);
}
