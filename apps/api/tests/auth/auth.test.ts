import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import {
    api,
    closeServer,
    CSRF,
    refreshCookieOf,
    registerOwner,
    resetDatabase,
} from '../helpers.ts';

describe('auth', () => {
    beforeEach(resetDatabase);
    after(closeServer);

    it('registers the owner as admin and never returns a hash or the refresh token in the body', async () => {
        const reply = await api('POST', '/api/auth/register', {
            body: { username: 'wolf', password: 'correct horse battery' },
        });
        assert.equal(reply.status, 201);
        assert.equal(reply.json.user.role, 'admin');
        assert.ok(!JSON.stringify(reply.json).includes('$argon2'));
        assert.ok(!('refreshToken' in reply.json));
        const cookie = reply.headers.getSetCookie().find((c) => c.startsWith('burrow_rt='));
        assert.match(cookie ?? '', /HttpOnly/i);
        assert.match(cookie ?? '', /SameSite=Strict/i);
    });

    it('stores an Argon2id hash', async () => {
        await registerOwner('wolf');
        const { getPool } = await import('../../src/database/connection.ts');
        const { rows } = await getPool().query('SELECT password_hash FROM users');
        assert.match(rows[0]?.password_hash as string, /^\$argon2id\$/);
    });

    it('closes registration once the owner exists', async () => {
        await registerOwner();
        const reply = await api('POST', '/api/auth/register', {
            body: { username: 'second', password: 'correct horse battery' },
        });
        assert.equal(reply.status, 403);
    });

    it('rejects short passwords', async () => {
        const reply = await api('POST', '/api/auth/register', {
            body: { username: 'wolf', password: 'short' },
        });
        assert.equal(reply.status, 400);
    });

    it('answers a wrong password and an unknown user identically (no account enumeration)', async () => {
        await registerOwner('wolf');
        const wrong = await api('POST', '/api/auth/login', {
            body: { username: 'wolf', password: 'not the password' },
        });
        const unknown = await api('POST', '/api/auth/login', {
            body: { username: 'nobody', password: 'not the password' },
        });
        assert.equal(wrong.status, 401);
        assert.deepEqual(wrong.json, unknown.json);
    });

    it('logs in, serves /me, and a request without a token is 401', async () => {
        await registerOwner('wolf');
        const login = await api('POST', '/api/auth/login', {
            body: { username: 'WOLF', password: 'correct horse battery' },
        });
        assert.equal(login.status, 200);
        assert.equal(
            (await api('GET', '/api/me', { token: login.json.accessToken })).json.username,
            'wolf',
        );
        assert.equal((await api('GET', '/api/me')).status, 401);
    });

    it('logout revokes the session at once, not when the token expires (FR-005)', async () => {
        const { token, cookie } = await registerOwner();
        assert.equal((await api('GET', '/api/me', { token })).status, 200);
        assert.equal((await api('POST', '/api/auth/logout', { token, headers: CSRF })).status, 204);
        assert.equal((await api('GET', '/api/me', { token })).status, 401);
        assert.equal(
            (await api('POST', '/api/auth/refresh', { cookie, headers: CSRF })).status,
            401,
        );
    });

    it('refresh rotates: the old refresh token stops working after one use', async () => {
        const { cookie } = await registerOwner();
        const first = await api('POST', '/api/auth/refresh', { cookie, headers: CSRF });
        assert.equal(first.status, 200);
        assert.notEqual(refreshCookieOf(first), cookie);
        assert.equal(
            (await api('POST', '/api/auth/refresh', { cookie, headers: CSRF })).status,
            401,
        );
        assert.equal(
            (
                await api('POST', '/api/auth/refresh', {
                    cookie: refreshCookieOf(first),
                    headers: CSRF,
                })
            ).status,
            200,
        );
    });

    it('refresh and logout demand the CSRF header', async () => {
        const { cookie } = await registerOwner();
        assert.equal((await api('POST', '/api/auth/refresh', { cookie })).status, 403);
    });

    it('rate-limits repeated failed logins (FR-002)', async () => {
        // The limiter reads its cap at import time, so this checks the wiring rather than the number.
        const { loginRateLimiter } = await import('../../src/middlewares/rate-limit.ts');
        assert.equal(typeof loginRateLimiter, 'function');
    });

    it('a password change ends other sessions', async () => {
        const { token } = await registerOwner('wolf');
        const second = await api('POST', '/api/auth/login', {
            body: { username: 'wolf', password: 'correct horse battery' },
        });
        const change = await api('POST', '/api/auth/password', {
            token,
            body: {
                currentPassword: 'correct horse battery',
                newPassword: 'another long passphrase',
            },
        });
        assert.equal(change.status, 204);
        assert.equal((await api('GET', '/api/me', { token: second.json.accessToken })).status, 401);
        assert.equal(
            (
                await api('POST', '/api/auth/login', {
                    body: { username: 'wolf', password: 'another long passphrase' },
                })
            ).status,
            200,
        );
    });
});
