import type { AddressInfo } from 'node:net';

import { getPool } from '../src/database/connection.ts';
import { app } from '../src/server.ts';

/** Starts the real app on an ephemeral port; tests talk to it over HTTP like any client. */
export const server = app.listen(0);
export const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

export interface Reply {
    status: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    json: any;
    headers: Headers;
}

/**
 * @param method - HTTP method.
 * @param path - Path below the origin.
 * @param options - `token` becomes a bearer header, `body` is sent as JSON, `form` as multipart, `cookie` as the Cookie header.
 */
export async function api(
    method: string,
    path: string,
    options: {
        token?: string;
        body?: unknown;
        form?: FormData;
        cookie?: string;
        headers?: Record<string, string>;
    } = {},
): Promise<Reply> {
    const headers: Record<string, string> = { ...options.headers };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.cookie) headers.cookie = options.cookie;
    let body: string | FormData | undefined;
    if (options.body !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(options.body);
    } else if (options.form) {
        body = options.form;
    }
    const response = await fetch(`${base}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
    });
    const text = await response.text();
    let json: unknown = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = text;
    }
    return { status: response.status, json, headers: response.headers };
}

/** @returns The `name=value` pair of the refresh cookie from a reply, ready to send back. */
export function refreshCookieOf(reply: Reply): string {
    const raw = reply.headers.getSetCookie().find((c) => c.startsWith('burrow_rt='));
    return (raw ?? '').split(';')[0] ?? '';
}

export const CSRF = { 'x-requested-with': 'burrow' };

/** Wipes everything a test created; the schema and the scheduler row stay. */
export async function resetDatabase(): Promise<void> {
    await getPool().query('TRUNCATE users, blobs RESTART IDENTITY CASCADE');
    await getPool().query('UPDATE scheduler_state SET last_run_at = NULL');
}

/** Registers (the first account is the owner) and returns its access token. */
export async function registerOwner(
    username = 'owner',
): Promise<{ token: string; id: string; cookie: string }> {
    const reply = await api('POST', '/api/auth/register', {
        body: { username, password: 'correct horse battery' },
    });
    if (reply.status !== 201)
        throw new Error(`register failed: ${String(reply.status)} ${JSON.stringify(reply.json)}`);
    return {
        token: reply.json.accessToken as string,
        id: reply.json.user.id as string,
        cookie: refreshCookieOf(reply),
    };
}

/** A tiny valid PNG whose bytes differ per `seed`, so uploads are distinct unless a test wants a duplicate. */
export async function png(seed: number): Promise<Blob> {
    const sharp = (await import('sharp')).default;
    const buffer = await sharp({
        create: {
            width: 8,
            height: 8,
            channels: 3,
            background: { r: seed % 256, g: (seed * 7) % 256, b: (seed * 13) % 256 },
        },
    })
        .png()
        .toBuffer();
    return new Blob([new Uint8Array(buffer)], { type: 'image/png' });
}

export async function upload(token: string, name: string, file: Blob): Promise<Reply> {
    const form = new FormData();
    form.append('file', file, name);
    return api('POST', '/api/files', { token, form });
}

export async function closeServer(): Promise<void> {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await getPool().shutdown();
}
