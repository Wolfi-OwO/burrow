import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { config } from '../../src/config/index.ts';
import type { Category } from '../../src/models/category.model.ts';
import { descend } from '../../src/services/classification-service.ts';
import { api, closeServer, registerOwner, resetDatabase } from '../helpers.ts';

after(closeServer);

/** A stand-in for llama.cpp: answers with whatever JSON the test queued, streamed in small pieces. */
let model: Server;
let next = '{"reply":"Hello.","actions":[]}';
let seenPrompt = '';
let healthy = true;

before(async () => {
    model = createServer((req, res) => {
        if (req.url === '/health') {
            res.statusCode = healthy ? 200 : 503;
            res.end('{}');
            return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => (body += chunk.toString()));
        req.on('end', () => {
            const sent = JSON.parse(body) as { messages: { role: string; content: string }[] };
            seenPrompt = sent.messages.map((m) => `${m.role}: ${m.content}`).join('\n');
            res.setHeader('content-type', 'text/event-stream');
            for (let i = 0; i < next.length; i += 9)
                res.write(
                    `data: ${JSON.stringify({ choices: [{ delta: { content: next.slice(i, i + 9) } }] })}\n\n`,
                );
            res.end('data: [DONE]\n\n');
        });
    });
    await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
    config.llm.rateLimitMax = 1000;
    config.llm.url = `http://127.0.0.1:${String((model.address() as AddressInfo).port)}`;
});
after(() => {
    config.llm.url = undefined;
    model.close();
});
beforeEach(async () => {
    await resetDatabase();
    healthy = true;
    next = '{"reply":"Hello.","actions":[]}';
});
afterEach(() => undefined);

interface Streamed {
    event: string;
    data: Record<string, unknown>;
}

async function talk(token: string, message: string): Promise<Streamed[]> {
    const reply = await api('POST', '/api/chat', { token, body: { message } });
    assert.equal(reply.status, 200);
    const text = typeof reply.json === 'string' ? reply.json : '';
    return text
        .split('\n\n')
        .filter(Boolean)
        .map((block) => {
            const event = /^event: (.*)$/m.exec(block)?.[1] ?? '';
            const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? '{}') as Record<
                string,
                unknown
            >;
            return { event, data };
        });
}

const turn = (reply: string, actions: object[]): string => JSON.stringify({ reply, actions });
const make = (name: string, parent = ''): object => ({
    type: 'create_category',
    name,
    parent,
    phrase: '',
});

describe('the assistant chat', () => {
    it('needs a login', async () => {
        assert.equal((await api('GET', '/api/chat')).status, 401);
        assert.equal((await api('POST', '/api/chat', { body: { message: 'hi' } })).status, 401);
    });

    it('streams the reply, creates the folders it was asked for and keeps the conversation', async () => {
        const { token } = await registerOwner();
        next = turn('Done, three folders.', [
            make('Travel'),
            make('Italy', 'Travel'),
            make('Spain', 'travel'),
        ]);
        const events = await talk(token, 'Make Travel with Italy and Spain');

        assert.equal(
            events
                .filter((e) => e.event === 'delta')
                .map((e) => e.data.text)
                .join(''),
            'Done, three folders.',
        );
        assert.deepEqual(
            events
                .filter((e) => e.event === 'action')
                .map((e) => (e.data.action as { status: string }).status),
            ['done', 'done', 'done'],
        );
        assert.equal(events.at(-1)?.event, 'done');

        const tree = (await api('GET', '/api/categories', { token })).json.categories as Category[];
        const byName = new Map(tree.map((c) => [c.name, c]));
        assert.equal(byName.get('Italy')?.parentId, byName.get('Travel')?.id);
        assert.equal(
            byName.get('Spain')?.parentId,
            byName.get('Travel')?.id,
            'parent found whatever its case',
        );

        const history = (await api('GET', '/api/chat', { token })).json;
        assert.deepEqual(
            history.messages.map((m: { role: string }) => m.role),
            ['user', 'assistant'],
        );
        assert.equal(history.messages[1].actions.length, 3);
        assert.equal(history.ready, true);
    });

    it('tells the model the folders that exist and what it learned, so the next answer can build on them', async () => {
        const { token } = await registerOwner();
        next = turn('ok', [make('Cats')]);
        await talk(token, 'make Cats');
        next = turn('ok', [
            { type: 'add_hint', name: 'Cats', parent: '', phrase: 'an orange tabby cat' },
        ]);
        await talk(token, 'Cats is my orange cat');
        await talk(token, 'what do you know?');
        assert.match(seenPrompt, /- Cats \(also scored as: an orange tabby cat\)/);
        assert.match(seenPrompt, /user: make Cats/);
    });

    it('does not repeat itself: a folder or phrase that exists is reported, not made twice', async () => {
        const { token } = await registerOwner();
        next = turn('ok', [make('Cats')]);
        await talk(token, 'make Cats');
        const again = await talk(token, 'make Cats');
        assert.equal(
            (again.find((e) => e.event === 'action')?.data.action as { status: string }).status,
            'exists',
        );
        assert.equal(
            ((await api('GET', '/api/categories', { token })).json.categories as Category[]).length,
            1,
        );
    });

    it('skips what cannot be done and says why, without failing the turn', async () => {
        const { token } = await registerOwner();
        next = turn('ok', [
            make('Italy', 'Nowhere'),
            { type: 'add_hint', name: 'Ghost', parent: '', phrase: 'a ghost' },
            make('   '),
            make('x'.repeat(200)),
        ]);
        const actions = (await talk(token, 'do things'))
            .filter((e) => e.event === 'action')
            .map((e) => e.data.action as { status: string; label: string });
        assert.deepEqual(
            actions.map((a) => a.status),
            ['skipped', 'skipped', 'skipped', 'done'],
        );
        assert.equal(actions[3]?.label.length, 60, 'a long name is cut to the folder name limit');
    });

    it("works only on the asking person's own folders", async () => {
        const first = await registerOwner();
        const other = (
            await api('POST', '/api/auth/register', {
                body: { username: 'other', password: 'correct horse battery' },
            })
        ).json.accessToken as string;
        next = turn('ok', [make('Private')]);
        await talk(first.token, 'make Private');
        next = turn('ok', [
            { type: 'add_hint', name: 'Private', parent: '', phrase: 'secret things' },
            make('Inside', 'Private'),
        ]);
        const actions = (await talk(other, 'use it'))
            .filter((e) => e.event === 'action')
            .map((e) => (e.data.action as { status: string }).status);
        assert.deepEqual(actions, ['skipped', 'skipped']);
        assert.equal(
            ((await api('GET', '/api/chat', { token: other })).json.messages as unknown[]).length,
            2,
        );
    });

    it('keeps the reply and takes no action when the model is cut off mid-answer', async () => {
        const { token } = await registerOwner();
        next = '{"reply":"Half an ans';
        const events = await talk(token, 'hi');
        assert.equal(events.at(-1)?.event, 'done');
        assert.deepEqual((events.at(-1)?.data.message as { actions: unknown[] }).actions, []);
    });

    it('answers that it is not running when the model server is down', async () => {
        const { token } = await registerOwner();
        healthy = false;
        const events = await talk(token, 'hi');
        assert.equal(events.at(-1)?.event, 'failed');
        assert.equal((await api('GET', '/api/chat', { token })).json.ready, false);
        assert.equal(
            ((await api('GET', '/api/chat', { token })).json.messages as unknown[]).length,
            0,
            'nothing is recorded',
        );
    });

    it('rejects an empty or oversized message and can clear the conversation', async () => {
        const { token } = await registerOwner();
        assert.equal(
            (await api('POST', '/api/chat', { token, body: { message: '  ' } })).status,
            400,
        );
        assert.equal(
            (await api('POST', '/api/chat', { token, body: { message: 'x'.repeat(1501) } })).status,
            400,
        );
        await talk(token, 'hi');
        assert.equal((await api('DELETE', '/api/chat', { token })).status, 204);
        assert.equal(
            ((await api('GET', '/api/chat', { token })).json.messages as unknown[]).length,
            0,
        );
    });
});

describe('what the chat taught the sorter', () => {
    const cat = (id: number, name: string): Category => ({
        id,
        userId: 'u',
        parentId: null,
        name,
        path: String(id),
        publicPreview: false,
    });
    const tree = [cat(1, 'Cats'), cat(2, 'Dogs')];
    const children = (parentId: number | null): Promise<Category[]> =>
        Promise.resolve(parentId === null ? tree : []);
    const scorer = (known: Record<string, number>) => (labels: string[]) =>
        Promise.resolve(labels.map((label) => ({ label, score: known[label] ?? 0 })));

    it('scores a folder under its taught phrases too, which can tip a picture into it', async () => {
        const score = scorer({ 'a picture of Luna': 0.7, Dogs: 0.2 });
        const without = await descend(children, score, 0.6, null, 0.3);
        assert.equal(without.category?.id === 1 && without.status === 'sorted', false);
        const taught = await descend(
            children,
            score,
            0.6,
            null,
            0.3,
            new Map([[1, ['a picture of Luna']]]),
        );
        assert.equal(taught.status, 'sorted');
        assert.equal(taught.category?.name, 'Cats');
    });
});
