import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { within } from '../../src/lib/within.ts';

describe('within', () => {
    it('lets a path inside the folder through, normalised', () => {
        assert.equal(within('/data', '/data/tmp/../tmp/a'), '/data/tmp/a');
        assert.equal(within('/data', '/data'), '/data');
    });

    it('refuses a path that leaves the folder, however it is written', () => {
        assert.throws(() => within('/data', '/data/../etc/passwd'));
        assert.throws(
            () => within('/data', '/database/x'),
            'a sibling with the same prefix is outside',
        );
        assert.throws(() => within('/data', '/etc/passwd'));
    });
});
