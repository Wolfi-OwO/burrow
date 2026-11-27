import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import { api, closeServer, registerOwner, resetDatabase } from '../helpers.ts';

after(closeServer);

/** What the browser sends: a derived proof, never the typed password. */
const proof = (tag: string): string => `pw1$${tag.padEnd(43, 'x')}`;
const TYPED = 'correct horse battery';

describe('password proof', () => {
    beforeEach(resetDatabase);

    it('stores an account created with a proof under the v1 scheme and signs it in with the proof', async () => {
        const made = await api('POST', '/api/auth/register', {
            body: { username: 'wolf', password: proof('a') },
        });
        assert.equal(made.status, 201);
        const { getPool } = await import('../../src/database/connection.ts');
        const { rows } = await getPool().query('SELECT password_scheme FROM users');
        assert.equal(rows[0]?.password_scheme, 'v1');
        const login = await api('POST', '/api/auth/login', {
            body: { username: 'wolf', password: proof('a') },
        });
        assert.equal(login.status, 200);
        const wrong = await api('POST', '/api/auth/login', {
            body: { username: 'wolf', password: proof('b') },
        });
        assert.equal(wrong.status, 401);
        assert.equal(wrong.json.legacyLogin, false);
    });

    it('moves a legacy account to the proof scheme on its first proof sign-in and stops asking for the typed password', async () => {
        await registerOwner('wolf'); // typed password, stored the old way
        const refused = await api('POST', '/api/auth/login', {
            body: { username: 'wolf', password: proof('a') },
        });
        assert.equal(refused.status, 401);
        assert.equal(refused.json.legacyLogin, true);

        const retried = await api('POST', '/api/auth/login', {
            body: { username: 'wolf', password: proof('a'), legacyPassword: TYPED },
        });
        assert.equal(retried.status, 200);

        const { getPool } = await import('../../src/database/connection.ts');
        const { rows } = await getPool().query('SELECT password_scheme FROM users');
        assert.equal(rows[0]?.password_scheme, 'v1');

        const again = await api('POST', '/api/auth/login', {
            body: { username: 'wolf', password: proof('a') },
        });
        assert.equal(again.status, 200);
        const stale = await api('POST', '/api/auth/login', {
            body: { username: 'wolf', password: proof('zzz') },
        });
        assert.equal(stale.json.legacyLogin, false);
    });

    it('refuses the retry when the typed password is wrong', async () => {
        await registerOwner('wolf');
        const reply = await api('POST', '/api/auth/login', {
            body: { username: 'wolf', password: proof('a'), legacyPassword: 'not the password' },
        });
        assert.equal(reply.status, 401);
    });

    it('still signs in a legacy account with the typed password alone (a page that has not reloaded yet)', async () => {
        await registerOwner('wolf');
        const reply = await api('POST', '/api/auth/login', {
            body: { username: 'wolf', password: TYPED },
        });
        assert.equal(reply.status, 200);
    });

    it('changes the password to a proof, accepting the old typed password once', async () => {
        const owner = await registerOwner('wolf');
        const reply = await api('POST', '/api/auth/password', {
            token: owner.token,
            body: {
                currentPassword: proof('old'),
                currentLegacyPassword: TYPED,
                newPassword: proof('new'),
            },
        });
        assert.equal(reply.status, 204);
        const login = await api('POST', '/api/auth/login', {
            body: { username: 'wolf', password: proof('new') },
        });
        assert.equal(login.status, 200);
    });
});

describe('passkeys', () => {
    beforeEach(resetDatabase);

    it('hands out sign-in options without a username and refuses to register one when signed out', async () => {
        const options = await api('POST', '/api/auth/passkey/options', { body: {} });
        assert.equal(options.status, 200);
        assert.match(String(options.json.options.challenge), /\S{20,}/);
        assert.match(String(options.json.ceremonyId), /^[0-9a-f-]{36}$/);
        const signedOut = await api('POST', '/api/auth/passkeys/register/options', { body: {} });
        assert.equal(signedOut.status, 401);
    });

    it('offers a signed-in user registration options and lists no passkeys yet', async () => {
        const owner = await registerOwner('wolf');
        const options = await api('POST', '/api/auth/passkeys/register/options', {
            token: owner.token,
            body: {},
        });
        assert.equal(options.status, 200);
        assert.equal(options.json.options.rp.name, 'burrow');
        assert.equal(options.json.options.user.name, 'wolf');
        const list = await api('GET', '/api/auth/passkeys', { token: owner.token });
        assert.deepEqual(list.json.passkeys, []);
    });

    it('rejects a made-up answer and never signs anyone in with it', async () => {
        const options = await api('POST', '/api/auth/passkey/options', { body: {} });
        const reply = await api('POST', '/api/auth/passkey/login', {
            body: {
                ceremonyId: options.json.ceremonyId,
                response: { id: 'AAAA', rawId: 'AAAA', type: 'public-key', response: {} },
            },
        });
        assert.equal(reply.status, 401);
        // the ceremony was used up by the attempt, so it cannot be tried again
        const replay = await api('POST', '/api/auth/passkey/login', {
            body: {
                ceremonyId: options.json.ceremonyId,
                response: { id: 'AAAA', rawId: 'AAAA', type: 'public-key', response: {} },
            },
        });
        assert.equal(replay.status, 401);
    });
});
