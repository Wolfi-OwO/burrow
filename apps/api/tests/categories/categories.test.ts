import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import { api, closeServer, png, registerOwner, resetDatabase, upload } from '../helpers.ts';

after(closeServer);

interface Node {
    id: number;
    name: string;
    depth: number;
    path: string;
    parentId: number | null;
    fileCount: number;
}

async function make(token: string, name: string, parentId: number | null = null): Promise<number> {
    const reply = await api('POST', '/api/categories', { token, body: { name, parentId } });
    assert.equal(reply.status, 201, JSON.stringify(reply.json));
    return reply.json.id as number;
}
const tree = async (token: string): Promise<Node[]> =>
    (await api('GET', '/api/categories', { token })).json.categories as Node[];

describe('category tree', () => {
    beforeEach(resetDatabase);

    it('creates nodes at any depth and returns them parent-before-child (FR-010, FR-013)', async () => {
        const { token } = await registerOwner();
        const a = await make(token, 'Furry');
        const b = await make(token, 'SFW', a);
        const c = await make(token, 'WOLF', b);
        const nodes = await tree(token);
        assert.deepEqual(
            nodes.map((n) => [n.name, n.depth]),
            [
                ['Furry', 0],
                ['SFW', 1],
                ['WOLF', 2],
            ],
        );
        assert.equal(nodes[2]?.path, `${String(a)}.${String(b)}.${String(c)}`);
    });

    it('keeps real names with any characters, since paths hold only surrogate ids (ADR-0003)', async () => {
        const { token } = await registerOwner();
        await make(token, '🐺 Wolf stuff / Café Photos');
        assert.equal((await tree(token))[0]?.name, '🐺 Wolf stuff / Café Photos');
    });

    it('rejects a duplicate sibling name case-insensitively but allows it under another parent', async () => {
        const { token } = await registerOwner();
        const a = await make(token, 'A');
        const b = await make(token, 'B');
        await make(token, 'Wolf', a);
        assert.equal(
            (await api('POST', '/api/categories', { token, body: { name: 'WOLF', parentId: a } }))
                .status,
            409,
        );
        assert.equal(
            (await api('POST', '/api/categories', { token, body: { name: 'Wolf', parentId: b } }))
                .status,
            201,
        );
    });

    it('renames at any depth without touching paths (FR-011)', async () => {
        const { token } = await registerOwner();
        const a = await make(token, 'A');
        const b = await make(token, 'B', a);
        const before = (await tree(token)).find((n) => n.id === b)?.path;
        assert.equal(
            (
                await api('PATCH', `/api/categories/${String(b)}`, {
                    token,
                    body: { name: 'Renamed' },
                })
            ).status,
            200,
        );
        const after = (await tree(token)).find((n) => n.id === b);
        assert.equal(after?.name, 'Renamed');
        assert.equal(after?.path, before);
    });

    it('moves a whole subtree and the files under it resolve to the new location at once (FR-014, FR-015)', async () => {
        const { token } = await registerOwner();
        const a = await make(token, 'A');
        const x = await make(token, 'X', a);
        const y = await make(token, 'Y', x);
        const dest = await make(token, 'Dest');
        const up = await upload(token, 'photo.png', await png(1));
        await api('PATCH', `/api/files/${up.json.file.id as string}`, {
            token,
            body: { categoryId: y },
        });

        const moved = await api('POST', `/api/categories/${String(x)}/move`, {
            token,
            body: { parentId: dest },
        });
        assert.equal(moved.status, 200);
        const nodes = await tree(token);
        assert.deepEqual(
            nodes.filter((n) => [x, y].includes(n.id)).map((n) => n.depth),
            [1, 2],
        );
        assert.ok(nodes.find((n) => n.id === y)?.path.startsWith(`${String(dest)}.${String(x)}.`));
        const file = (await api('GET', `/api/files/${up.json.file.id as string}`, { token })).json;
        assert.deepEqual(file.categoryPath, ['Dest', 'X', 'Y']);
    });

    it('refuses to move a node into its own subtree and leaves the tree unchanged (FR-014)', async () => {
        const { token } = await registerOwner();
        const a = await make(token, 'A');
        const b = await make(token, 'B', a);
        const before = JSON.stringify(await tree(token));
        assert.equal(
            (
                await api('POST', `/api/categories/${String(a)}/move`, {
                    token,
                    body: { parentId: b },
                })
            ).status,
            400,
        );
        assert.equal(
            (
                await api('POST', `/api/categories/${String(a)}/move`, {
                    token,
                    body: { parentId: a },
                })
            ).status,
            400,
        );
        assert.equal(JSON.stringify(await tree(token)), before);
    });

    it('a move that collides with a sibling name fails whole, leaving everything where it was', async () => {
        const { token } = await registerOwner();
        const a = await make(token, 'A');
        const dest = await make(token, 'Dest');
        await make(token, 'Same', dest);
        const same = await make(token, 'same', a);
        await make(token, 'Child', same);
        const before = JSON.stringify(await tree(token));
        assert.equal(
            (
                await api('POST', `/api/categories/${String(same)}/move`, {
                    token,
                    body: { parentId: dest },
                })
            ).status,
            409,
        );
        assert.equal(JSON.stringify(await tree(token)), before);
    });

    it('deleting a non-empty node needs a choice: block refuses, moveUp lifts the contents (FR-012)', async () => {
        const { token } = await registerOwner();
        const a = await make(token, 'A');
        const b = await make(token, 'B', a);
        await make(token, 'C', b);
        const up = await upload(token, 'p.png', await png(2));
        await api('PATCH', `/api/files/${up.json.file.id as string}`, {
            token,
            body: { categoryId: b },
        });

        assert.equal((await api('DELETE', `/api/categories/${String(b)}`, { token })).status, 409);
        assert.equal(
            (await api('DELETE', `/api/categories/${String(b)}?onNonEmpty=moveUp`, { token }))
                .status,
            204,
        );
        const nodes = await tree(token);
        assert.deepEqual(
            nodes.map((n) => [n.name, n.depth]),
            [
                ['A', 0],
                ['C', 1],
            ],
        );
        assert.deepEqual(
            (await api('GET', `/api/files/${up.json.file.id as string}`, { token })).json
                .categoryPath,
            ['A'],
        );
    });

    it("never shows or touches another user's categories", async () => {
        const { token } = await registerOwner();
        const a = await make(token, 'Mine');
        const { getPool } = await import('../../src/database/connection.ts');
        const { rows } = await getPool().query(
            `INSERT INTO users (username, display_name) VALUES ('other', 'Other') RETURNING id`,
        );
        await getPool().query(
            `INSERT INTO sessions (user_id, refresh_hash, expires_at) VALUES ($1, 'x', now() + interval '1 day')`,
            [rows[0]?.id],
        );
        assert.equal(
            (
                await api('PATCH', `/api/categories/${String(a)}`, {
                    token,
                    body: { name: 'Hacked' },
                })
            ).status,
            200,
        );
        assert.equal(
            (await api('PATCH', '/api/categories/99999', { token, body: { name: 'Nope' } })).status,
            404,
        );
        assert.equal(
            (await api('PATCH', '/api/categories/abc', { token, body: { name: 'Nope' } })).status,
            404,
        );
    });
});

interface Setup {
    furry: number;
    sfw: number;
    wolf: number;
    nsfw: number;
    nature: number;
    wolfFile: string;
    sfwFile: string;
    natureFile: string;
}

describe('deleting folders with everything below them', () => {
    beforeEach(resetDatabase);

    /** Furry > SFW > WOLF, Furry > NSFW, Nature, with one file in WOLF, one in SFW and one in Nature. */
    async function setup(token: string): Promise<Setup> {
        const furry = await make(token, 'Furry');
        const sfw = await make(token, 'SFW', furry);
        const wolf = await make(token, 'WOLF', sfw);
        const nsfw = await make(token, 'NSFW', furry);
        const nature = await make(token, 'Nature');
        const put = async (name: string, seed: number, category: number): Promise<string> => {
            const id = (await upload(token, name, await png(seed))).json.file.id as string;
            await api('PATCH', `/api/files/${id}`, { token, body: { categoryId: category } });
            return id;
        };
        return {
            furry,
            sfw,
            wolf,
            nsfw,
            nature,
            wolfFile: await put('w.png', 1, wolf),
            sfwFile: await put('s.png', 2, sfw),
            natureFile: await put('n.png', 3, nature),
        };
    }
    const where = async (token: string, id: string): Promise<number | null> =>
        (await api('GET', `/api/files/${id}`, { token })).json.categoryId as number | null;

    it('removes the folder and all folders below it, and moves their files up to the parent', async () => {
        const { token } = await registerOwner();
        const t = await setup(token);
        const reply = await api('DELETE', `/api/categories/${String(t.sfw)}?onNonEmpty=subtree`, {
            token,
        });
        assert.equal(reply.status, 200);
        assert.deepEqual(reply.json, { categories: 2, files: 2 });
        assert.deepEqual(
            (await tree(token)).map((n) => n.name),
            ['Furry', 'NSFW', 'Nature'],
        );
        assert.equal(
            await where(token, t.wolfFile),
            t.furry,
            'the file from two levels down is in the parent',
        );
        assert.equal(await where(token, t.sfwFile), t.furry);
        assert.equal(await where(token, t.natureFile), t.nature, 'other folders are untouched');
    });

    it('sends the files of a removed top-level folder to Unsorted, and deletes none', async () => {
        const { token } = await registerOwner();
        const t = await setup(token);
        const reply = await api('DELETE', `/api/categories/${String(t.furry)}?onNonEmpty=subtree`, {
            token,
        });
        assert.deepEqual(reply.json, { categories: 4, files: 2 });
        assert.equal(await where(token, t.wolfFile), null);
        assert.equal(await where(token, t.sfwFile), null);
        assert.equal(
            ((await api('GET', '/api/files?limit=10', { token })).json.files as unknown[]).length,
            3,
        );
    });

    it('deletes several at once, a folder and its own descendant in the same request counted once', async () => {
        const { token } = await registerOwner();
        const t = await setup(token);
        const reply = await api('POST', '/api/categories/delete', {
            token,
            body: { ids: [t.furry, t.wolf, t.nature, t.furry] },
        });
        assert.equal(reply.status, 200);
        assert.deepEqual(reply.json, { categories: 5, files: 3 });
        assert.deepEqual(await tree(token), []);
        assert.equal(
            ((await api('GET', '/api/files?limit=10', { token })).json.files as unknown[]).length,
            3,
        );
    });

    it('removes nothing when one of the ids is not yours, and refuses an empty or oversized list', async () => {
        const { token } = await registerOwner();
        const other = (
            await api('POST', '/api/auth/register', {
                body: { username: 'other', password: 'correct horse battery' },
            })
        ).json.accessToken as string;
        const mine = await make(token, 'Mine');
        const theirs = await make(other, 'Theirs');
        assert.equal(
            (await api('POST', '/api/categories/delete', { token, body: { ids: [mine, theirs] } }))
                .status,
            404,
        );
        assert.equal((await tree(token)).length, 1, 'my folder is still there');
        assert.equal((await tree(other)).length, 1);
        assert.equal(
            (await api('POST', '/api/categories/delete', { token, body: { ids: [] } })).status,
            400,
        );
        assert.equal(
            (
                await api('POST', '/api/categories/delete', {
                    token,
                    body: { ids: Array.from({ length: 501 }, (_, i) => i + 1) },
                })
            ).status,
            400,
        );
        assert.equal(
            (await api('POST', '/api/categories/delete', { body: { ids: [mine] } })).status,
            401,
        );
    });
});
