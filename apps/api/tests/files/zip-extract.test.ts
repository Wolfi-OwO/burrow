import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { extractZip } from '../../src/lib/zip-extract.ts';
import { closeServer, zipOf } from '../helpers.ts';

const limits = { maxEntries: 100, maxEntryBytes: 1_000_000, maxTotalBytes: 10_000_000 };

async function archive(names: string[]): Promise<{ dir: string; zip: string; staging: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'zip-extract-'));
    const staging = join(dir, 'staging');
    await import('node:fs/promises').then((fs) => fs.mkdir(staging));
    const zip = join(dir, 'a.zip');
    await writeFile(
        zip,
        Buffer.from(
            await zipOf(
                names.map((name) => ({ name, data: Buffer.from(`data of ${name}`) })),
            ).arrayBuffer(),
        ),
    );
    return { dir, zip, staging };
}

describe('unpacking a zip when storing one of its files fails', () => {
    after(closeServer);

    it('skips that file, reports it and still finishes the rest (it used to hang)', async () => {
        const { dir, zip, staging } = await archive(['a.txt', 'b.txt', 'c.txt']);
        const stored: string[] = [];
        const summary = await extractZip(zip, staging, limits, async (path, _size, name) => {
            if (name === 'b.txt') throw new Error('database hiccup');
            stored.push(name);
            await rm(path, { force: true });
        });
        assert.deepEqual(stored, ['a.txt', 'c.txt']);
        assert.deepEqual(summary, { extracted: 2, skipped: 1 });
        assert.deepEqual(await readdir(staging), [], 'nothing is left in the staging folder');
        await rm(dir, { recursive: true, force: true });
    });

    it('stops with the reason when the failure would hit every later file too', async () => {
        const { dir, zip, staging } = await archive(['a.txt', 'b.txt', 'c.txt']);
        const seen: string[] = [];
        await assert.rejects(
            extractZip(
                zip,
                staging,
                { ...limits, isFatal: (error) => (error as Error).message === 'no room' },
                async (path, _size, name) => {
                    seen.push(name);
                    await rm(path, { force: true });
                    if (name === 'b.txt') throw new Error('no room');
                },
            ),
            /no room/,
        );
        assert.deepEqual(seen, ['a.txt', 'b.txt'], 'c.txt was never started');
        assert.deepEqual(await readdir(staging), []);
        await rm(dir, { recursive: true, force: true });
    });
});
