import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';

import { config } from '../../src/config/index.ts';
import { getPool } from '../../src/database/connection.ts';
import { schedulerService } from '../../src/services/scheduler-service.ts';
import { api, closeServer, png, registerOwner, resetDatabase, upload } from '../helpers.ts';

/** A stand-in for apps/vision, so these tests exercise the API's own logic without a model. */
let vision: Server;
let behaviour = { nsfw: 0.01, scores: {} as Record<string, number> };
let embedCalls = 0;
let seenToken: string | undefined;

before(() => {
    vision = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
            const body = Buffer.concat(chunks).toString('latin1');
            res.setHeader('content-type', 'application/json');
            if (req.url === '/health') return void res.end('{"status":"ok"}');
            if (req.url === '/embed') {
                embedCalls += 1;
                seenToken = req.headers['x-internal-service-token'] as string | undefined;
                return void res.end(
                    JSON.stringify({
                        embedding: Array.from({ length: 512 }, (_, i) => (i === 0 ? 1 : 0)),
                    }),
                );
            }
            if (req.url === '/nsfw') return void res.end(JSON.stringify({ nsfw: behaviour.nsfw }));
            const labels = JSON.parse(
                /name="labels"\r\n\r\n([^\r]*)/.exec(body)?.[1] ?? '[]',
            ) as string[];
            return void res.end(
                JSON.stringify({
                    scores: labels.map((label) => ({ label, score: behaviour.scores[label] ?? 0 })),
                }),
            );
        });
    }).listen(0);
    config.vision.url = `http://127.0.0.1:${String((vision.address() as AddressInfo).port)}`;
});
after(async () => {
    vision.close();
    await closeServer();
});
beforeEach(async () => {
    await resetDatabase();
    behaviour = { nsfw: 0.01, scores: {} };
    embedCalls = 0;
});

const category = async (
    token: string,
    name: string,
    parentId: number | null = null,
    publicPreview = false,
): Promise<number> =>
    (await api('POST', '/api/categories', { token, body: { name, parentId, publicPreview } })).json
        .id as number;
interface FileJson {
    status: string;
    categoryId: number | null;
    categoryPath: string[];
    suggestedCategoryId: number | null;
    nsfwScore: number;
}
const fileOf = async (token: string, id: string): Promise<FileJson> =>
    (await api('GET', `/api/files/${id}`, { token })).json as FileJson;

describe('sorting', () => {
    it('files an image under the confident category and stores its embedding (FR-032)', async () => {
        const { token } = await registerOwner();
        const furry = await category(token, 'Furry');
        const wolf = await category(token, 'WOLF', furry);
        behaviour.scores = { Furry: 0.95, WOLF: 0.9 };
        const { file } = (await upload(token, 'a.png', await png(1))).json;

        assert.equal((await api('POST', '/api/sorting/run', { token })).json.decided, 1);
        const after = await fileOf(token, file.id as string);
        assert.equal(after.status, 'sorted');
        assert.equal(after.categoryId, wolf);
        assert.deepEqual(after.categoryPath, ['Furry', 'WOLF']);
        const row = await getPool().query(
            'SELECT vector_dims(embedding) AS d FROM files WHERE id = $1',
            [file.id],
        );
        assert.equal(row.rows[0]?.d, 512);
    });

    it('does not reprocess a file a previous run already decided (FR-041)', async () => {
        const { token } = await registerOwner();
        await category(token, 'Furry');
        behaviour.scores = { Furry: 0.95 };
        await upload(token, 'a.png', await png(2));
        await api('POST', '/api/sorting/run', { token });
        const callsAfterFirst = embedCalls;
        const second = await api('POST', '/api/sorting/run', { token });
        assert.equal(second.json.decided, 0);
        assert.equal(embedCalls, callsAfterFirst);
    });

    it('sends the internal service token to the vision service', async () => {
        const { token } = await registerOwner();
        await category(token, 'Furry');
        behaviour.scores = { Furry: 0.95 };
        config.vision.serviceToken = 'service-token-for-tests';
        try {
            await upload(token, 'a.png', await png(3));
            await api('POST', '/api/sorting/run', { token });
            assert.equal(seenToken, 'service-token-for-tests');
        } finally {
            config.vision.serviceToken = undefined;
        }
    });

    it('"Sort now" works through the whole backlog, not one batch', async () => {
        const { token } = await registerOwner();
        await category(token, 'Furry');
        behaviour.scores = { Furry: 0.95 };
        const before = config.sorting.batchSize;
        config.sorting.batchSize = 2;
        try {
            for (let i = 0; i < 5; i++) await upload(token, `g${String(i)}.png`, await png(40 + i));
            const run = await api('POST', '/api/sorting/run', { token });
            assert.equal(run.json.decided, 5);
            assert.equal(run.json.remaining, 0);
        } finally {
            config.sorting.batchSize = before;
        }
    });

    it('two scheduler steps at once never double-run the backlog: exactly one process holds the lock (FR-042)', async () => {
        const { token } = await registerOwner();
        await category(token, 'Furry');
        behaviour.scores = { Furry: 0.95 };
        for (let i = 0; i < 5; i++) await upload(token, `f${String(i)}.png`, await png(20 + i));
        const results = await Promise.all([
            schedulerService.tick(true),
            schedulerService.tick(true),
        ]);
        assert.equal(
            results.filter((r) => r === null).length + results.filter((r) => r === 5).length,
            2,
        );
        assert.equal(
            results.reduce<number>((sum, r) => sum + (r ?? 0), 0),
            5,
        );
        assert.equal(embedCalls, 5);
    });

    it('sends a low-confidence file to the review queue with its suggestion (FR-043)', async () => {
        const { token } = await registerOwner();
        const furry = await category(token, 'Furry');
        behaviour.scores = { Furry: 0.4, 'something else': 0.6 };
        const { file } = (await upload(token, 'a.png', await png(3))).json;
        await api('POST', '/api/sorting/run', { token });

        const queue = (await api('GET', '/api/review', { token })).json.files;
        assert.equal(queue.length, 1);
        assert.equal(queue[0].id, file.id);
        assert.equal(queue[0].suggestedCategoryId, furry);
        assert.equal(queue[0].suggestedName, 'Furry');
        assert.equal(queue[0].categoryId, null);
    });

    it('lets the user accept, pick another category, or leave unsorted, and the item never returns (FR-044, FR-045)', async () => {
        const { token } = await registerOwner();
        const furry = await category(token, 'Furry');
        const nature = await category(token, 'Nature');
        behaviour.scores = { Furry: 0.4, Nature: 0.3 };
        const [a, b, c] = await Promise.all(
            [31, 32, 33].map(
                async (n) =>
                    (await upload(token, `f${String(n)}.png`, await png(n))).json.file.id as string,
            ),
        );
        await api('POST', '/api/sorting/run', { token });
        assert.equal((await api('GET', '/api/review', { token })).json.files.length, 3);

        assert.equal(
            (await api('POST', `/api/review/${a}`, { token, body: { action: 'accept' } })).json
                .categoryId,
            furry,
        );
        assert.equal(
            (
                await api('POST', `/api/review/${b}`, {
                    token,
                    body: { action: 'move', categoryId: nature },
                })
            ).json.categoryId,
            nature,
        );
        const left = (await api('POST', `/api/review/${c}`, { token, body: { action: 'leave' } }))
            .json;
        assert.equal(left.status, 'unsorted');
        assert.equal(left.categoryId, null);

        assert.equal((await api('GET', '/api/review', { token })).json.files.length, 0);
        const before = embedCalls;
        assert.equal((await api('POST', '/api/sorting/run', { token })).json.decided, 0);
        assert.equal(embedCalls, before);
        assert.equal(
            (await api('POST', `/api/review/${a}`, { token, body: { action: 'accept' } })).status,
            404,
        );
    });

    it('never auto-files an NSFW file into a category that may be previewed publicly (FR-037)', async () => {
        const { token } = await registerOwner();
        const shown = await category(token, 'Showcase', null, true);
        behaviour.scores = { Showcase: 0.99 };
        behaviour.nsfw = 0.97;
        const { file } = (await upload(token, 'a.png', await png(4))).json;
        await api('POST', '/api/sorting/run', { token });
        const after = await fileOf(token, file.id as string);
        assert.equal(after.status, 'review');
        assert.equal(after.categoryId, null);
        assert.equal(after.suggestedCategoryId, shown);
        assert.ok(after.nsfwScore > 0.9);
    });

    it('files a SFW file into the same public category normally', async () => {
        const { token } = await registerOwner();
        await category(token, 'Showcase', null, true);
        behaviour.scores = { Showcase: 0.99 };
        const { file } = (await upload(token, 'a.png', await png(5))).json;
        await api('POST', '/api/sorting/run', { token });
        assert.equal((await fileOf(token, file.id as string)).status, 'sorted');
    });

    it('marks non-image files as seen so they are not retried forever', async () => {
        const { token } = await registerOwner();
        await category(token, 'Docs');
        await upload(token, 'notes.txt', new Blob(['hello'], { type: 'text/plain' }));
        await api('POST', '/api/sorting/run', { token });
        assert.equal((await api('GET', '/api/sorting/status', { token })).json.backlog, 0);
    });

    it('keeps a file in the backlog when the vision service is unreachable, so the next run retries it', async () => {
        const { token } = await registerOwner();
        await category(token, 'Furry');
        await upload(token, 'a.png', await png(6));
        const real = config.vision.url;
        config.vision.url = 'http://127.0.0.1:1';
        await api('POST', '/api/sorting/run', { token });
        config.vision.url = real;
        assert.equal((await api('GET', '/api/sorting/status', { token })).json.backlog, 1);
    });

    it('reports the schedule: backlog, runs per day and whether vision is healthy', async () => {
        const { token } = await registerOwner();
        await upload(token, 'a.png', await png(7));
        const status = (await api('GET', '/api/sorting/status', { token })).json;
        assert.equal(status.backlog, 1);
        assert.equal(status.visionHealthy, true);
        assert.equal(status.runsPerDay, 10);
        assert.equal(status.autoFileThreshold, config.sorting.autoFileThreshold);
    });
});
