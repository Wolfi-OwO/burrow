import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import { getPool } from '../../src/database/connection.ts';
import { api, closeServer, png, registerOwner, resetDatabase, upload } from '../helpers.ts';

const vector = (head: number, tail = 0): string =>
    `[${Array.from({ length: 512 }, (_, i) => (i === 0 ? head : i === 1 ? tail : 0)).join(',')}]`;

describe('duplicates and ratings', () => {
    beforeEach(resetDatabase);
    after(closeServer);

    it('finds byte-identical files, keeps the filed one and removes the rest', async () => {
        const { token } = await registerOwner();
        const cat = (
            await api('POST', '/api/categories', { token, body: { name: 'Pics', parentId: null } })
        ).json.id as number;
        const same = await png(7);
        const first = (await upload(token, 'a.png', same)).json.file.id as string;
        const second = (await upload(token, 'b.png', same)).json.file.id as string;
        await upload(token, 'other.png', await png(8));
        await api('PATCH', `/api/files/${second}`, { token, body: { categoryId: cat } });

        const found = await api('GET', '/api/duplicates?mode=exact', { token });
        assert.equal(found.json.groups.length, 1);
        assert.equal(found.json.groups[0].files.length, 2);
        assert.equal(found.json.groups[0].keepId, second, 'the filed copy is the one to keep');

        const done = await api('POST', '/api/duplicates/clean', { token, body: { mode: 'exact' } });
        assert.equal(done.json.removed, 1);
        const left = await api('GET', '/api/files?limit=50', { token });
        assert.equal(left.json.files.length, 2);
        assert.equal((await api('GET', `/api/files/${first}`, { token })).status, 404);
    });

    it('finds near-identical pictures by their embeddings, not unrelated ones', async () => {
        const { token } = await registerOwner();
        const ids: string[] = [];
        for (let i = 0; i < 3; i++)
            ids.push(
                (await upload(token, `p${String(i)}.png`, await png(30 + i))).json.file
                    .id as string,
            );
        const db = getPool();
        await db.query('UPDATE files SET embedding = $2::vector WHERE id = $1', [
            ids[0],
            vector(1, 0),
        ]);
        await db.query('UPDATE files SET embedding = $2::vector WHERE id = $1', [
            ids[1],
            vector(1, 0.01),
        ]);
        await db.query('UPDATE files SET embedding = $2::vector WHERE id = $1', [
            ids[2],
            vector(0, 1),
        ]);

        const found = await api('GET', '/api/duplicates?mode=similar', { token });
        assert.equal(found.json.groups.length, 1);
        assert.deepEqual(
            found.json.groups[0].files.map((f: { id: string }) => f.id).sort(),
            [ids[0], ids[1]].sort(),
        );
    });

    it('moves files whose NSFW score contradicts their SFW / NSFW folder', async () => {
        const { token } = await registerOwner();
        const furry = (
            await api('POST', '/api/categories', { token, body: { name: 'Furry', parentId: null } })
        ).json.id as number;
        const sfw = (
            await api('POST', '/api/categories', { token, body: { name: 'SFW', parentId: furry } })
        ).json.id as number;
        const nsfw = (
            await api('POST', '/api/categories', { token, body: { name: 'NSFW', parentId: furry } })
        ).json.id as number;
        const wrong = (await upload(token, 'x.png', await png(50))).json.file.id as string;
        const right = (await upload(token, 'y.png', await png(51))).json.file.id as string;
        for (const [id, score] of [
            [wrong, 0.9],
            [right, 0.05],
        ] as const) {
            await api('PATCH', `/api/files/${id}`, { token, body: { categoryId: sfw } });
            await getPool().query('UPDATE files SET nsfw_score = $2 WHERE id = $1', [id, score]);
        }
        const preview = await api('GET', '/api/sorting/ratings', { token });
        assert.deepEqual(preview.json, { toExplicit: 1, toSafe: 0 });
        await api('POST', '/api/sorting/ratings', { token });
        assert.equal((await api('GET', `/api/files/${wrong}`, { token })).json.categoryId, nsfw);
        assert.equal((await api('GET', `/api/files/${right}`, { token })).json.categoryId, sfw);
    });

    it('sends a folder back to the sorter', async () => {
        const { token } = await registerOwner();
        const cat = (
            await api('POST', '/api/categories', { token, body: { name: 'Pics', parentId: null } })
        ).json.id as number;
        const id = (await upload(token, 'a.png', await png(60))).json.file.id as string;
        await api('PATCH', `/api/files/${id}`, { token, body: { categoryId: cat } });
        const queued = await api('POST', '/api/sorting/resort', {
            token,
            body: { categoryId: cat },
        });
        assert.equal(queued.json.queued, 1);
        const file = (await api('GET', `/api/files/${id}`, { token })).json;
        assert.equal(file.categoryId, null);
        assert.equal(file.status, 'unsorted');
    });
});
