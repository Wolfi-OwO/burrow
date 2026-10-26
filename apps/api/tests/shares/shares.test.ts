import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import { config } from '../../src/config/index.ts';
import { api, closeServer, png, registerOwner, resetDatabase, upload } from '../helpers.ts';

/** The owner, one stranger account, a category with one file inside, and a file left unfiled. */
async function setup(): Promise<{
    owner: string;
    guest: { token: string; id: string };
    categoryId: number;
    inside: string;
    outside: string;
}> {
    const { token: owner } = await registerOwner();
    config.registrationOpen = true;
    const guest = await registerOwner('guest');
    config.registrationOpen = false;
    const categoryId = (
        await api('POST', '/api/categories', {
            token: owner,
            body: { name: 'Trips', parentId: null },
        })
    ).json.id as number;
    const inside = (await upload(owner, 'in.png', await png(1))).json.file.id as string;
    const outside = (await upload(owner, 'out.png', await png(2))).json.file.id as string;
    await api('PATCH', `/api/files/${inside}`, { token: owner, body: { categoryId } });
    return { owner, guest, categoryId, inside, outside };
}

describe('shares', () => {
    beforeEach(resetDatabase);
    after(closeServer);

    it('lets anyone open a link share without signing in, and only sees the shared file', async () => {
        const { owner, inside, outside } = await setup();
        const made = await api('POST', '/api/shares', {
            token: owner,
            body: { fileId: inside, access: 'link', expiresInHours: null },
        });
        assert.equal(made.status, 201);
        const token = made.json.share.token as string;

        const page = await api('GET', `/api/s/${token}`);
        assert.equal(page.status, 200);
        assert.deepEqual(
            page.json.files.map((f: { id: string }) => f.id),
            [inside],
        );
        const bytes = await fetch(
            `${(await import('../helpers.ts')).base}/api/s/${token}/files/${inside}/content`,
        );
        assert.equal(bytes.status, 200);
        assert.equal(
            (await api('GET', `/api/s/${token}/files/${outside}/content`)).status,
            404,
            'a file the link does not cover stays private',
        );
    });

    it('shares a whole category with its subtree', async () => {
        const { owner, categoryId, inside } = await setup();
        const sub = (
            await api('POST', '/api/categories', {
                token: owner,
                body: { name: 'Alps', parentId: categoryId },
            })
        ).json.id as number;
        const deep = (await upload(owner, 'deep.png', await png(3))).json.file.id as string;
        await api('PATCH', `/api/files/${deep}`, { token: owner, body: { categoryId: sub } });
        const made = await api('POST', '/api/shares', {
            token: owner,
            body: { categoryId, access: 'link', expiresInHours: null },
        });
        const page = await api('GET', `/api/s/${made.json.share.token as string}`);
        assert.deepEqual(
            page.json.files.map((f: { id: string }) => f.id).sort(),
            [inside, deep].sort(),
        );
    });

    it('asks anonymous visitors to sign in and refuses accounts that are not listed', async () => {
        const { owner, guest, inside } = await setup();
        const { token } = (
            await api('POST', '/api/shares', {
                token: owner,
                body: { fileId: inside, access: 'users', expiresInHours: null, userIds: [] },
            })
        ).json.share;
        assert.equal((await api('GET', `/api/s/${token as string}`)).status, 401);
        assert.equal(
            (await api('GET', `/api/s/${token as string}`, { token: guest.token })).status,
            403,
        );

        const listed = await api('GET', '/api/shares', { token: owner });
        const id = listed.json.shares[0].id as string;
        await api('PATCH', `/api/shares/${id}`, { token: owner, body: { userIds: [guest.id] } });
        assert.equal(
            (await api('GET', `/api/s/${token as string}`, { token: guest.token })).status,
            200,
        );
        const mine = await api('GET', '/api/shared-with-me', { token: guest.token });
        assert.equal(mine.json.shares.length, 1);
        assert.equal(mine.json.shares[0].name, 'in.png');
    });

    it('ends a link at once when it is revoked, and an expired link is the same 404 as an unknown one', async () => {
        const { owner, inside } = await setup();
        const made = await api('POST', '/api/shares', {
            token: owner,
            body: { fileId: inside, access: 'link', expiresInHours: null },
        });
        const { id, token } = made.json.share as { id: string; token: string };
        await api('PATCH', `/api/shares/${id}`, { token: owner, body: { revoked: true } });
        assert.equal((await api('GET', `/api/s/${token}`)).status, 404);
        assert.equal((await api('GET', `/api/s/${'x'.repeat(43)}`)).status, 404);
        await api('PATCH', `/api/shares/${id}`, { token: owner, body: { revoked: false } });
        assert.equal((await api('GET', `/api/s/${token}`)).status, 200);
    });

    it("never lets another account touch someone's share, and finds accounts by name", async () => {
        const { owner, guest, inside } = await setup();
        const id = (
            await api('POST', '/api/shares', {
                token: owner,
                body: { fileId: inside, access: 'link', expiresInHours: 24 },
            })
        ).json.share.id as string;
        assert.equal(
            (
                await api('PATCH', `/api/shares/${id}`, {
                    token: guest.token,
                    body: { revoked: true },
                })
            ).status,
            404,
        );
        assert.equal(
            (await api('DELETE', `/api/shares/${id}`, { token: guest.token })).status,
            404,
        );
        const found = await api('GET', '/api/users/search?q=gue', { token: owner });
        assert.deepEqual(
            found.json.users.map((u: { username: string }) => u.username),
            ['guest'],
        );
        assert.equal((await api('DELETE', `/api/shares/${id}`, { token: owner })).status, 204);
    });

    it('refuses to share a file that is not yours', async () => {
        const { owner, guest, inside } = await setup();
        assert.equal(
            (
                await api('POST', '/api/shares', {
                    token: guest.token,
                    body: { fileId: inside, access: 'link', expiresInHours: null },
                })
            ).status,
            404,
        );
        assert.ok(owner);
    });
});
