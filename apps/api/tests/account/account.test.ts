import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { after, beforeEach, describe, it } from 'node:test';

import { getPool } from '../../src/database/connection.ts';
import { localBlobPath } from '../../src/lib/blob-store.ts';
import { api, base, closeServer, png, registerOwner, resetDatabase, upload } from '../helpers.ts';

after(closeServer);

const PASSWORD = 'correct horse battery';

/** Registers another account (registration is open to everyone) and returns its token. */
async function registerSecond(username = 'second'): Promise<{ token: string; id: string }> {
    const reply = await api('POST', '/api/auth/register', {
        body: { username, password: PASSWORD },
    });
    assert.equal(reply.status, 201);
    return { token: reply.json.accessToken as string, id: reply.json.user.id as string };
}

const exists = (sha: string): Promise<boolean> =>
    access(localBlobPath(sha)).then(
        () => true,
        () => false,
    );

describe('account export (Art 15 and 20 DSGVO)', () => {
    beforeEach(resetDatabase);

    it('streams a zip with the account, the file list and the file bytes, and nothing of anyone else', async () => {
        const owner = await registerOwner();
        const second = await registerSecond();
        await upload(owner.token, 'mine.png', await png(1));
        await upload(second.token, 'theirs.png', await png(2));

        const response = await fetch(`${base}/api/me/export`, {
            headers: { authorization: `Bearer ${owner.token}` },
        });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'application/zip');
        assert.match(
            response.headers.get('content-disposition') ?? '',
            /attachment; filename="burrow-export-owner-/,
        );
        const bytes = Buffer.from(await response.arrayBuffer());
        const text = bytes.toString('latin1');
        assert.equal(bytes.readUInt32LE(0), 0x04034b50, 'starts with a zip local header');
        for (const name of [
            'account.json',
            'categories.json',
            'files.json',
            'files/Unsorted/mine.png',
        ]) {
            assert.ok(text.includes(name), `contains ${name}`);
        }
        assert.ok(!text.includes('theirs.png'), "never contains another account's file");
        assert.ok(!text.includes('password_hash'), 'never contains a hash');
    });

    it('needs a signed-in account', async () => {
        assert.equal((await api('GET', '/api/me/export')).status, 401);
    });
});

describe('account deletion (Art 17 DSGVO)', () => {
    beforeEach(resetDatabase);

    it('refuses without the username and with a wrong password', async () => {
        await registerOwner();
        const second = await registerSecond();

        const noName = await api('DELETE', '/api/me', {
            token: second.token,
            body: { username: 'someone-else', password: PASSWORD },
        });
        assert.equal(noName.status, 400);
        const wrongPassword = await api('DELETE', '/api/me', {
            token: second.token,
            body: { username: 'second', password: 'not the password' },
        });
        assert.equal(wrongPassword.status, 403);
        assert.equal((await api('GET', '/api/me', { token: second.token })).status, 200);
    });

    it('treats the first account like any other: it can delete itself', async () => {
        const first = await registerOwner();
        const done = await api('DELETE', '/api/me', {
            token: first.token,
            body: { username: 'owner', password: PASSWORD },
        });
        assert.equal(done.status, 204);
        assert.equal((await api('GET', '/api/me', { token: first.token })).status, 401);
    });

    it('removes the account, its files, categories and sessions, and a blob only when nobody else uses it', async () => {
        const owner = await registerOwner();
        const second = await registerSecond();
        const shared = await png(7);
        const ownOnly = await png(8);
        const a = (await upload(owner.token, 'shared.png', shared)).json.file;
        await upload(second.token, 'shared-too.png', shared);
        await upload(second.token, 'only-theirs.png', ownOnly);
        // A three-level tree: categories reference their parent with ON DELETE RESTRICT, so order matters.
        let parentId: number | null = null;
        for (const name of ['Parent', 'Child', 'Grandchild']) {
            const made = await api('POST', '/api/categories', {
                token: second.token,
                body: { name, parentId },
            });
            assert.equal(made.status, 201);
            parentId = made.json.id as number;
        }

        const { rows } = await getPool().query(
            'SELECT blob_sha256 AS sha, name FROM files ORDER BY name',
        );
        const sha = (name: string): string => rows.find((r) => r.name === name)?.sha as string;
        assert.ok(await exists(sha('shared.png')));
        assert.ok(await exists(sha('only-theirs.png')));

        const done = await api('DELETE', '/api/me', {
            token: second.token,
            body: { username: 'SECOND', password: PASSWORD },
        });
        assert.equal(done.status, 204);

        assert.equal((await api('GET', '/api/me', { token: second.token })).status, 401);
        const login = await api('POST', '/api/auth/login', {
            body: { username: 'second', password: PASSWORD },
        });
        assert.equal(login.status, 401);

        const counts = await getPool().query(
            `SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM files)::int AS files,
                    (SELECT count(*) FROM categories)::int AS categories`,
        );
        assert.deepEqual(counts.rows[0], { users: 1, files: 1, categories: 0 });
        assert.ok(await exists(sha('shared.png')), 'a blob another account still uses stays');
        assert.equal(
            await exists(sha('only-theirs.png')),
            false,
            'a blob nobody uses any more goes',
        );
        assert.equal(
            (await api('GET', `/api/files/${String(a.id)}`, { token: owner.token })).status,
            200,
        );
    });
});
