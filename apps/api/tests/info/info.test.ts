import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { api, closeServer } from '../helpers.ts';

after(closeServer);

describe('GET /api/info', () => {
    it('answers the same shape every app of the stack answers, without signing in', async () => {
        const { status, json } = await api('GET', '/api/info');
        assert.equal(status, 200);
        assert.equal(json.name, 'burrow');
        for (const key of ['version', 'revision', 'buildDate', 'repositoryUrl'])
            assert.equal(typeof json[key], 'string', `${key} is a string`);
    });

    it('keeps /api/version for what already reads it, with the same content', async () => {
        const info = await api('GET', '/api/info');
        const version = await api('GET', '/api/version');
        assert.deepEqual(version.json, info.json);
    });
});
