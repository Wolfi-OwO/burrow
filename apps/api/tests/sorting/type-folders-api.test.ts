import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import { api, closeServer, registerOwner, resetDatabase, upload } from '../helpers.ts';

describe('folders for types that have none', () => {
    beforeEach(resetDatabase);
    after(closeServer);

    it('reports what no folder fits, and creates exactly those folders', async () => {
        const { token } = await registerOwner();
        await upload(token, 'main.py', new Blob(['print(1)'], { type: 'text/x-python' }));
        // no extension and no type, but the bytes say mp4
        const mp4 = new Blob([
            Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]),
        ]);
        await upload(token, 'media-5', mp4);
        await api('POST', '/api/categories', { token, body: { name: 'Documents' } });
        await upload(token, 'notes.txt', new Blob(['hi'], { type: 'text/plain' }));

        const before = await api('GET', '/api/sorting/unplaced', { token });
        const names = (before.json.kinds as { name: string }[]).map((k) => k.name).sort();
        assert.deepEqual(names, ['Code', 'Video']);
        assert.equal(before.json.total, 2);

        const made = await api('POST', '/api/sorting/type-folders', { token });
        assert.equal(made.status, 201);
        assert.deepEqual([...made.json.created].sort(), ['Code', 'Video']);
        const tree = (await api('GET', '/api/categories', { token })).json.categories as {
            name: string;
        }[];
        assert.ok(tree.some((c) => c.name === 'Code') && tree.some((c) => c.name === 'Video'));
        const after = await api('GET', '/api/sorting/unplaced', { token });
        assert.equal(after.json.total, 0);
    });
});
