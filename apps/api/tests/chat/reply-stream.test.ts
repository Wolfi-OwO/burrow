import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ReplyStream } from '../../src/lib/reply-stream.ts';

/** Feeds a document through the extractor in pieces of `size` characters. */
function through(document: string, size: number): string {
    const stream = new ReplyStream();
    let out = '';
    for (let i = 0; i < document.length; i += size) out += stream.push(document.slice(i, i + size));
    return out;
}

describe('reading the reply out of a JSON document that is still arriving', () => {
    const document = JSON.stringify({
        reply: 'Done, "Cats" is ready.\nLine two \\ and ü ✓',
        actions: [{ type: 'create_category', name: 'reply', parent: '', phrase: '' }],
    });
    const expected = 'Done, "Cats" is ready.\nLine two \\ and ü ✓';

    it('gives the same text however the document is cut into pieces', () => {
        for (const size of [1, 2, 3, 7, 50, document.length])
            assert.equal(through(document, size), expected, `piece size ${String(size)}`);
    });

    it('stops at the end of the reply and ignores the actions after it', () => {
        assert.equal(through('{"reply":"hi","actions":[{"name":"\\"reply\\":\\"x"}]}', 4), 'hi');
    });

    it('says nothing until the reply has started', () => {
        const stream = new ReplyStream();
        assert.equal(stream.push('{"rep'), '');
        assert.equal(stream.push('ly":'), '');
        assert.equal(stream.push('"Hel'), 'Hel');
    });

    it('waits for the rest of an escape that is cut in half', () => {
        const stream = new ReplyStream();
        assert.equal(stream.push('{"reply":"a\\'), 'a');
        assert.equal(stream.push('u00'), '');
        assert.equal(stream.push('fc!'), 'ü!');
    });
});
