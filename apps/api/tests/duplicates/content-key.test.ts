import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { contentKey, normalizeText } from '../../src/lib/content-key.ts';
import { closeServer, zipOf } from '../helpers.ts';

const dir = await mkdtemp(join(tmpdir(), 'burrow-key-'));
after(async () => {
    await rm(dir, { recursive: true, force: true });
    await closeServer();
});

async function keyOf(
    name: string,
    data: Buffer | string,
    mime = 'application/octet-stream',
): Promise<string | null> {
    const path = join(dir, `${Math.random().toString(36).slice(2)}-${name}`);
    await writeFile(path, data);
    return contentKey(path, name, mime);
}

describe('content key', () => {
    it('ignores line endings, a BOM and trailing blanks in texts', async () => {
        const a = await keyOf('a.txt', 'one\ntwo\n');
        const b = await keyOf('copy of a.txt', '﻿one  \r\ntwo\r\n\r\n');
        assert.equal(a, b);
        assert.notEqual(a, await keyOf('c.txt', 'one\nthree\n'));
        assert.equal(normalizeText('x \r\ny\r'), 'x\ny');
    });

    it('gives a zip-based document the same key after it was saved again', async () => {
        const entries = [
            { name: 'word/document.xml', data: Buffer.from('<w>hello</w>') },
            { name: 'docProps/core.xml', data: Buffer.from('<saved>1</saved>') },
        ];
        const first = Buffer.from(await zipOf(entries).arrayBuffer());
        const again = Buffer.from(
            await zipOf([
                entries[0] as (typeof entries)[0],
                { name: 'docProps/core.xml', data: Buffer.from('<saved>2</saved>') },
            ]).arrayBuffer(),
        );
        const a = await keyOf('a.docx', first);
        assert.ok(a?.startsWith('zip:'));
        assert.equal(a, await keyOf('b final.docx', again));
        const other = Buffer.from(
            await zipOf([
                { name: 'word/document.xml', data: Buffer.from('<w>other</w>') },
            ]).arrayBuffer(),
        );
        assert.notEqual(a, await keyOf('c.docx', other));
    });

    it('has no key for pictures and binary files', async () => {
        assert.equal(await keyOf('a.png', Buffer.from([1, 2, 3]), 'image/png'), null);
        assert.equal(await keyOf('a.txt', Buffer.from([65, 0, 66])), null);
    });
});
