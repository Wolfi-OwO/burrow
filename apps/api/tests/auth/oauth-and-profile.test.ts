import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import { config } from '../../src/config/index.ts';
import { signOAuthState, verifyOAuthState } from '../../src/lib/oauth-state.ts';
import type { OAuthProfile } from '../../src/lib/oauth-providers.ts';
import { buildAuthorizeUrl } from '../../src/lib/oauth-providers.ts';
import { oauthService } from '../../src/services/oauth-service.ts';
import { api, upload, closeServer, png, registerOwner, resetDatabase } from '../helpers.ts';

const profile = (over: Partial<OAuthProfile> = {}): OAuthProfile => ({
    providerUserId: 'gh-1',
    email: 'wolf@example.org',
    emailVerified: true,
    displayName: 'Wolf',
    pictureUrl: null,
    ...over,
});

after(closeServer);

describe('OIDC login and linking (FR-006 to FR-009)', () => {
    beforeEach(resetDatabase);

    it('creates the owner account from a first provider login and recognises the same login next time', async () => {
        const first = await oauthService.resolveLogin('github', profile());
        assert.equal(first.role, 'admin');
        assert.equal(first.passwordHash, null);
        assert.equal((await oauthService.resolveLogin('github', profile())).id, first.id);
    });

    it('uses one code path for all three providers: a verified matching email links to the existing account', async () => {
        const user = await oauthService.resolveLogin('github', profile());
        const viaGoogle = await oauthService.resolveLogin(
            'google',
            profile({ providerUserId: 'g-9' }),
        );
        const viaMicrosoft = await oauthService.resolveLogin(
            'microsoft',
            profile({ providerUserId: 'm-7' }),
        );
        assert.equal(viaGoogle.id, user.id);
        assert.equal(viaMicrosoft.id, user.id);
        assert.equal((await oauthService.listIdentities(user.id)).length, 3);
    });

    it('never merges on an UNVERIFIED email: that would let someone claim an address they do not own', async () => {
        await oauthService.resolveLogin('github', profile());
        await assert.rejects(
            oauthService.resolveLogin(
                'google',
                profile({ providerUserId: 'evil', emailVerified: false }),
            ),
            /Registration is closed/,
        );
    });

    it('refuses a provider that shares no email', async () => {
        await assert.rejects(
            oauthService.resolveLogin('github', profile({ email: null })),
            /no email/,
        );
    });

    it('opens a new account only when registration is open', async () => {
        await oauthService.resolveLogin('github', profile());
        config.registrationOpen = true;
        try {
            const second = await oauthService.resolveLogin(
                'google',
                profile({ providerUserId: 'g-2', email: 'other@example.org' }),
            );
            assert.equal(second.role, 'user');
        } finally {
            config.registrationOpen = false;
        }
    });

    it('links a second provider only when its email is verified (FR-009)', async () => {
        const { id } = await registerOwner();
        await assert.rejects(
            oauthService.link(id, 'github', profile({ emailVerified: false })),
            /did not confirm/,
        );
        await oauthService.link(id, 'github', profile());
        assert.deepEqual(
            (await oauthService.listIdentities(id)).map((i) => i.provider),
            ['github'],
        );
    });

    it('refuses to link a provider account that already belongs to someone else', async () => {
        const user = await oauthService.resolveLogin('github', profile());
        config.registrationOpen = true;
        const other = await oauthService.resolveLogin(
            'google',
            profile({ providerUserId: 'g-5', email: 'b@example.org' }),
        );
        config.registrationOpen = false;
        await assert.rejects(oauthService.link(other.id, 'github', profile()), /already linked/);
        assert.ok(user.id !== other.id);
    });

    it('removes a link only while another way to log in remains', async () => {
        const user = await oauthService.resolveLogin('github', profile());
        await assert.rejects(oauthService.unlink(user.id, 'github'), /only way to log in/);
        await oauthService.link(user.id, 'google', profile({ providerUserId: 'g-1' }));
        assert.equal(await oauthService.unlink(user.id, 'github'), true);
        await assert.rejects(oauthService.unlink(user.id, 'google'), /only way to log in/);
    });

    it('signs the state per provider and carries who is linking; a state for another provider is rejected', () => {
        const state = signOAuthState('github', 'user-1');
        assert.deepEqual(verifyOAuthState(state, 'github'), { linkUserId: 'user-1' });
        assert.deepEqual(verifyOAuthState(signOAuthState('github'), 'github'), {
            linkUserId: null,
        });
        assert.throws(() => verifyOAuthState(state, 'google'));
        assert.throws(() => verifyOAuthState(undefined, 'github'));
        assert.throws(() => verifyOAuthState('garbage', 'github'));
    });

    it('builds the provider authorize URL with the callback and state', () => {
        config.oauth.github.clientId = 'cid';
        config.oauth.github.clientSecret = 'sec';
        const url = new URL(
            buildAuthorizeUrl('github', 'https://burrow.example/api/auth/github/callback', 'STATE'),
        );
        assert.equal(url.hostname, 'github.com');
        assert.equal(url.searchParams.get('state'), 'STATE');
        assert.equal(
            url.searchParams.get('redirect_uri'),
            'https://burrow.example/api/auth/github/callback',
        );
    });

    it('offers only configured providers on the login page and 404s the rest', async () => {
        config.oauth.github.clientId = undefined;
        config.oauth.github.clientSecret = undefined;
        assert.equal(
            (await api('GET', '/api/auth/providers')).json.providers.includes('github'),
            false,
        );
        assert.equal((await api('GET', '/api/auth/github')).status, 404);
    });
});

describe('profile (FR-018, FR-019)', () => {
    beforeEach(resetDatabase);

    it('edits display name and bio independently of the login identity', async () => {
        const { token } = await registerOwner('wolf');
        const reply = await api('PATCH', '/api/me', {
            token,
            body: { displayName: 'Fenrir', bio: 'Howls at the moon.' },
        });
        assert.equal(reply.json.displayName, 'Fenrir');
        assert.equal(reply.json.username, 'wolf');
        assert.equal((await api('PATCH', '/api/me', { token, body: {} })).status, 400);
    });

    it('stores the avatar through the same blob store as files, re-encoded, and serves it', async () => {
        const { token, id } = await registerOwner();
        const form = new FormData();
        form.append('file', await png(40), 'me.png');
        const reply = await api('PUT', '/api/me/avatar', { token, form });
        assert.equal(reply.status, 200);
        assert.equal(reply.json.hasAvatar, true);
        const { getPool } = await import('../../src/database/connection.ts');
        const row = await getPool().query(
            'SELECT u.avatar_sha256, b.mime FROM users u JOIN blobs b ON b.sha256 = u.avatar_sha256 WHERE u.id = $1',
            [id],
        );
        assert.equal(row.rows[0]?.mime, 'image/webp');
        const { base } = await import('../helpers.ts');
        const served = await fetch(`${base}/api/users/${id}/avatar`, {
            headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(served.headers.get('content-type'), 'image/webp');
    });

    it("uses one of the drive pictures as the avatar, and only the owner's own", async () => {
        const { token, id } = await registerOwner();
        const file = (await upload(token, 'me.png', await png(41))).json.file.id as string;
        const reply = await api('POST', '/api/me/avatar/from-file', {
            token,
            body: { fileId: file },
        });
        assert.equal(reply.status, 200);
        assert.equal(reply.json.hasAvatar, true);
        const { base } = await import('../helpers.ts');
        const served = await fetch(`${base}/api/users/${id}/avatar`, {
            headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(served.headers.get('content-type'), 'image/webp');
        const other = await api('POST', '/api/me/avatar/from-file', {
            token,
            body: { fileId: '00000000-0000-4000-8000-000000000000' },
        });
        assert.equal(other.status, 404);
    });

    it('rejects an avatar that is not an image', async () => {
        const { token } = await registerOwner();
        const form = new FormData();
        form.append('file', new Blob(['not an image'], { type: 'image/png' }), 'x.png');
        assert.equal((await api('PUT', '/api/me/avatar', { token, form })).status, 400);
    });

    it('shows other users a profile without username, email or linked providers (FR-019)', async () => {
        const { token, id } = await registerOwner('wolf');
        await oauthService.link(id, 'github', profile());
        const view = (await api('GET', `/api/users/${id}`, { token })).json;
        assert.deepEqual(Object.keys(view).sort(), ['bio', 'displayName', 'hasAvatar', 'id']);
        assert.ok(!JSON.stringify(view).includes('example.org'));
    });
});
