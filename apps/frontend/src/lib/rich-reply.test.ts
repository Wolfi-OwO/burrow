import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseBlocks, parseTree } from '../lib/rich-reply.ts';

describe('what the assistant writes', () => {
    it('splits fenced blocks from the text around them, also while a fence is still open', () => {
        const blocks = parseBlocks('Here:\n```tree\nA\n  B\n```\nDone');
        assert.deepEqual(
            blocks.map((b) => b.kind),
            ['text', 'tree', 'text'],
        );
        assert.deepEqual(
            parseBlocks('Here:\n```tree\nA\n  B').map((b) => b.kind),
            ['text', 'tree'],
        );
    });

    it('builds a forest from indentation and reads the counts', () => {
        const forest = parseTree(['Private (3)', '  Documents (1)', '    Word', 'Other: 2']);
        assert.equal(forest.length, 2);
        assert.equal(forest[0]?.children[0]?.children[0]?.name, 'Word');
        assert.equal(forest[0]?.count, '3');
        assert.equal(forest[1]?.count, '2');
    });
});
