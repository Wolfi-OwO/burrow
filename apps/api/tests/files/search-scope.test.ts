import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';

import { api, closeServer, png, registerOwner, resetDatabase, upload } from '../helpers.ts';

after(closeServer);
beforeEach(resetDatabase);

describe('searching inside a folder', () => {
    it('looks in that folder and the folders below it, and nowhere else', async () => {
        const { token } = await registerOwner();
        const make = async (name: string, parentId: number | null): Promise<number> =>
            (await api('POST', '/api/categories', { token, body: { name, parentId } })).json
                .id as number;
        const place = async (
            name: string,
            seed: number,
            folder: number | null,
        ): Promise<string> => {
            const id = (await upload(token, name, await png(seed))).json.file.id as string;
            if (folder !== null)
                await api('PATCH', `/api/files/${id}`, { token, body: { categoryId: folder } });
            return id;
        };
        const trips = await make('Trips', null);
        const alps = await make('Alps', trips);
        const home = await make('Home', null);
        const top = await place('sunset top.png', 21, trips);
        const deep = await place('sunset deep.png', 22, alps);
        const elsewhere = await place('sunset elsewhere.png', 23, home);
        const loose = await place('sunset loose.png', 24, null);

        const ids = async (query: string): Promise<string[]> =>
            (
                (await api('GET', `/api/search?q=sunset${query}`, { token })).json.files as {
                    id: string;
                }[]
            )
                .map((f) => f.id)
                .sort();

        assert.deepEqual(
            await ids(''),
            [top, deep, elsewhere, loose].sort(),
            'everywhere by default',
        );
        assert.deepEqual(await ids(`&category=${String(trips)}`), [top, deep].sort());
        assert.deepEqual(await ids(`&category=${String(alps)}`), [deep]);
        assert.deepEqual(await ids(`&category=${String(home)}`), [elsewhere]);
    });
});

describe('moving a selection', () => {
    it('files only the chosen files, only the account’s own, and can send them back to Unsorted', async () => {
        const { token } = await registerOwner();
        const other = await registerOwner('someone-else');
        const make = async (name: string): Promise<number> =>
            (await api('POST', '/api/categories', { token, body: { name, parentId: null } })).json
                .id as number;
        const from = await make('From');
        const to = await make('To');
        const ids: string[] = [];
        for (const n of [41, 42, 43]) {
            const id = (await upload(token, `m${String(n)}.png`, await png(n))).json.file
                .id as string;
            await api('PATCH', `/api/files/${id}`, { token, body: { categoryId: from } });
            ids.push(id);
        }
        const theirs = (await upload(other.token, 'theirs.png', await png(44))).json.file
            .id as string;
        const where = async (id: string): Promise<number | null> =>
            (await api('GET', `/api/files/${id}`, { token })).json.categoryId as number | null;

        const moved = await api('POST', '/api/files/move', {
            token,
            body: { ids: [ids[0], ids[1], theirs], categoryId: to },
        });
        assert.equal(moved.status, 200);
        assert.equal(moved.json.moved, 2, 'the other account’s file is not counted');
        assert.equal(await where(ids[0] as string), to);
        assert.equal(await where(ids[1] as string), to);
        assert.equal(await where(ids[2] as string), from, 'the unselected file stays');
        assert.equal(
            (await api('GET', `/api/files/${theirs}`, { token: other.token })).json.categoryId,
            null,
            'the other account’s file did not move',
        );

        const back = await api('POST', '/api/files/move', {
            token,
            body: { ids: [ids[0]], categoryId: null },
        });
        assert.equal(back.json.moved, 1);
        assert.equal(await where(ids[0] as string), null);

        assert.equal(
            (
                await api('POST', '/api/files/move', {
                    token,
                    body: { ids: [ids[0]], categoryId: 99999 },
                })
            ).status,
            404,
        );
        assert.equal(
            (await api('POST', '/api/files/move', { token, body: { ids: [], categoryId: to } }))
                .status,
            400,
        );
    });
});
