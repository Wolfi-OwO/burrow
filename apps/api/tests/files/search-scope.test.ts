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
