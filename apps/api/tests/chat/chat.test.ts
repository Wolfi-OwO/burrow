import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { config } from '../../src/config/index.ts';
import { getPool } from '../../src/database/connection.ts';
import type { Category } from '../../src/models/category.model.ts';
import { descend } from '../../src/services/classification-service.ts';
import { svgProblem } from '../../src/services/chat-service.ts';
import { api, base, closeServer, png, registerOwner, resetDatabase, upload } from '../helpers.ts';

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
const act = (type: string, name = '', extra: Record<string, string> = {}): object => ({
    type,
    name,
    parent: '',
    phrase: '',
    content: '',
    ...extra,
});
const make = (name: string, parent = ''): object => act('create_category', name, { parent });

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

    it('never puts the tree path into a folder name, and renames folders that have one', async () => {
        const { token } = await registerOwner();
        next = turn('Done.', [
            make('Nature'),
            make('Nature > Alps'),
            make('Wrong', 'Nature'),
            act('rename_category', 'Nature > Wrong', { phrase: 'Nature > Lakes' }),
        ]);
        await talk(token, 'make nature with alps and lakes');

        const tree = (await api('GET', '/api/categories', { token })).json.categories as Category[];
        const byName = new Map(tree.map((c) => [c.name, c]));
        assert.deepEqual([...byName.keys()].sort(), ['Alps', 'Lakes', 'Nature']);
        assert.equal(byName.get('Alps')?.parentId, byName.get('Nature')?.id);
        assert.equal(byName.get('Lakes')?.parentId, byName.get('Nature')?.id);
    });

    it('builds a drawn folder tree exactly as drawn, even when a folder name already exists elsewhere', async () => {
        const { token } = await registerOwner();
        next = turn('x', [make('NSFW')]);
        await talk(token, 'make nsfw');
        next = turn('unused', []);
        await talk(
            token,
            'Private\n|- Furry\n    |- NSFW\n        (maybe add kinks like -> foot, etc.\n    |- SFW\n|- Nature\n    (Then make categories for: Alps, Lakes)',
        );
        const tree = (await api('GET', '/api/categories', { token })).json.categories as Category[];
        const path = (c: Category): string => {
            const parent = tree.find((p) => p.id === c.parentId);
            return parent ? `${path(parent)} > ${c.name}` : c.name;
        };
        assert.deepEqual(
            tree.map(path).sort(),
            [
                'NSFW',
                'Private',
                'Private > Furry',
                'Private > Furry > NSFW',
                'Private > Furry > NSFW > Foot',
                'Private > Furry > SFW',
                'Private > Nature',
                'Private > Nature > Alps',
                'Private > Nature > Lakes',
            ].sort(),
        );
    });

    it('builds the tree but leaves the words around it out of the folder names, and answers the question', async () => {
        const { token } = await registerOwner();
        next = turn('Maybe Pets, Food and Friends.', []);
        const events = await talk(
            token,
            'Good, create these:\n\nPrivate\n|- Furry\n|- Nature\n\nWhich categories would you also recommend?',
        );
        const tree = (await api('GET', '/api/categories', { token })).json.categories as Category[];
        assert.deepEqual(tree.map((c) => c.name).sort(), ['Furry', 'Nature', 'Private']);
        assert.equal(
            events
                .filter((e) => e.event === 'delta')
                .map((e) => e.data.text)
                .join(''),
            'Maybe Pets, Food and Friends.',
        );
        assert.equal(events.filter((e) => e.event === 'action').length, 3);
    });

    it('tells the model the folders that exist and what it learned, so the next answer can build on them', async () => {
        const { token } = await registerOwner();
        next = turn('ok', [make('Cats')]);
        await talk(token, 'make Cats');
        next = turn('ok', [act('add_hint', 'Cats', { phrase: 'an orange tabby cat' })]);
        await talk(token, 'Cats is my orange cat');
        await talk(token, 'what do you know?');
        assert.match(seenPrompt, /- Cats \(0 files; also scored as: an orange tabby cat\)/);
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
            act('add_hint', 'Ghost', { phrase: 'a ghost' }),
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
            act('add_hint', 'Private', { phrase: 'secret things' }),
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

describe('the assistant changing and removing what is there', () => {
    /** Sends one turn and returns the id of the assistant message and its actions. */
    async function ask(
        token: string,
        actions: object[],
    ): Promise<{ id: number; actions: { status: string }[] }> {
        next = turn('ok', actions);
        const events = await talk(token, 'tidy up my folders');
        return events.at(-1)?.data.message as { id: number; actions: { status: string }[] };
    }
    const answer = (
        token: string,
        id: number,
        index: number,
        decision: string,
    ): ReturnType<typeof api> =>
        api('POST', `/api/chat/messages/${String(id)}/actions/${String(index)}`, {
            token,
            body: { decision },
        });
    async function filed(token: string): Promise<{ name: string; categoryId: number | null }> {
        const cat = (
            await api('POST', '/api/categories', { token, body: { name: 'Pics', parentId: null } })
        ).json.id as number;
        const id = (await upload(token, 'a.png', await png(1))).json.file.id as string;
        await api('PATCH', `/api/files/${id}`, { token, body: { categoryId: cat } });
        return { name: 'Pics', categoryId: cat };
    }

    it("waits for the person's yes before unsorting, and then does exactly that", async () => {
        const { token } = await registerOwner();
        await filed(token);
        const message = await ask(token, [act('unsort_all')]);
        assert.equal(message.actions[0]?.status, 'pending');
        assert.equal(
            (await api('GET', '/api/files?limit=5', { token })).json.files[0].categoryId !== null,
            true,
            'nothing changed yet',
        );

        const done = await answer(token, message.id, 0, 'confirm');
        assert.equal(done.json.action.status, 'done');
        assert.equal(
            (await api('GET', '/api/files?limit=5', { token })).json.files[0].categoryId,
            null,
        );
        assert.equal(
            ((await api('GET', '/api/categories', { token })).json.categories as unknown[]).length,
            1,
            'the folder stays',
        );
        assert.equal(
            (await answer(token, message.id, 0, 'confirm')).status,
            400,
            'it cannot be confirmed twice',
        );
    });

    it('leaves everything as it was when the person says no', async () => {
        const { token } = await registerOwner();
        await filed(token);
        const message = await ask(token, [act('remove_all_categories')]);
        const declined = await answer(token, message.id, 0, 'decline');
        assert.equal(declined.json.action.status, 'declined');
        assert.equal(
            ((await api('GET', '/api/categories', { token })).json.categories as unknown[]).length,
            1,
        );
        const stored = (await api('GET', '/api/chat', { token })).json.messages.at(-1).actions[0];
        assert.equal(stored.status, 'declined', 'the answer is remembered');
    });

    it('removes a folder by lifting its files and subfolders up, and never deletes a file', async () => {
        const { token } = await registerOwner();
        const parent = (
            await api('POST', '/api/categories', {
                token,
                body: { name: 'Travel', parentId: null },
            })
        ).json.id as number;
        const child = (
            await api('POST', '/api/categories', {
                token,
                body: { name: 'Italy', parentId: parent },
            })
        ).json.id as number;
        const id = (await upload(token, 'rome.png', await png(2))).json.file.id as string;
        await api('PATCH', `/api/files/${id}`, { token, body: { categoryId: child } });

        const message = await ask(token, [act('remove_category', 'Italy')]);
        assert.match((message.actions[0] as unknown as { detail: string }).detail, /1 file/);
        await answer(token, message.id, 0, 'confirm');
        assert.equal(
            (await api('GET', `/api/files/${id}`, { token })).json.categoryId,
            parent,
            'the file moved up',
        );
        assert.equal(
            ((await api('GET', '/api/categories', { token })).json.categories as unknown[]).length,
            1,
        );
    });

    it('unsorts everything and removes every folder in the order they were confirmed, keeping all files', async () => {
        const { token } = await registerOwner();
        await filed(token);
        const message = await ask(token, [act('unsort_all'), act('remove_all_categories')]);
        await answer(token, message.id, 0, 'confirm');
        await answer(token, message.id, 1, 'confirm');
        assert.equal(
            ((await api('GET', '/api/categories', { token })).json.categories as unknown[]).length,
            0,
        );
        const files = (await api('GET', '/api/files?limit=5', { token })).json.files as {
            categoryId: number | null;
        }[];
        assert.equal(files.length, 1, 'the file is still there');
        assert.equal(files[0]?.categoryId, null);
    });

    it('unsorts one folder only', async () => {
        const { token } = await registerOwner();
        const a = (
            await api('POST', '/api/categories', { token, body: { name: 'A', parentId: null } })
        ).json.id as number;
        const b = (
            await api('POST', '/api/categories', { token, body: { name: 'B', parentId: null } })
        ).json.id as number;
        const fa = (await upload(token, 'a.png', await png(3))).json.file.id as string;
        const fb = (await upload(token, 'b.png', await png(4))).json.file.id as string;
        await api('PATCH', `/api/files/${fa}`, { token, body: { categoryId: a } });
        await api('PATCH', `/api/files/${fb}`, { token, body: { categoryId: b } });
        const message = await ask(token, [act('unsort_category', 'A')]);
        await answer(token, message.id, 0, 'confirm');
        assert.equal((await api('GET', `/api/files/${fa}`, { token })).json.categoryId, null);
        assert.equal((await api('GET', `/api/files/${fb}`, { token })).json.categoryId, b);
    });

    it('skips what has nothing to do and cannot be confirmed by someone else', async () => {
        const first = await registerOwner();
        const other = (
            await api('POST', '/api/auth/register', {
                body: { username: 'other', password: 'correct horse battery' },
            })
        ).json.accessToken as string;
        const empty = await ask(first.token, [
            act('unsort_all'),
            act('remove_all_categories'),
            act('remove_category', 'Nope'),
        ]);
        assert.deepEqual(
            empty.actions.map((a) => a.status),
            ['skipped', 'skipped', 'skipped'],
        );

        await filed(first.token);
        const message = await ask(first.token, [act('unsort_all')]);
        assert.equal((await answer(other, message.id, 0, 'confirm')).status, 404);
        assert.equal((await answer(first.token, message.id, 5, 'confirm')).status, 404);
    });

    it('tells the model how many files each folder holds', async () => {
        const { token } = await registerOwner();
        await filed(token);
        await talk(token, 'how is my drive?');
        assert.match(seenPrompt, /Files in total: 1\. Not in any folder: 0\./);
        assert.match(seenPrompt, /- Pics \(1 file\)/);
    });
});

describe('the assistant writing files', () => {
    const file = (name: string, content: string, parent = ''): object =>
        act('create_file', name, { content, parent });
    async function written(
        token: string,
        actions: object[],
    ): Promise<{ status: string; fileId?: string; detail?: string }[]> {
        next = turn('ok', actions);
        const events = await talk(token, 'write it');
        return events
            .filter((e) => e.event === 'action')
            .map((e) => e.data.action as { status: string; fileId?: string; detail?: string });
    }

    it('saves a Markdown document, a PlantUML diagram and an SVG drawing as ordinary files, in the folder asked for', async () => {
        const { token } = await registerOwner();
        await api('POST', '/api/categories', { token, body: { name: 'Docs', parentId: null } });
        const svg =
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="red"/></svg>';
        const results = await written(token, [
            file('notes.md', '# Notes\n\nHello.', 'Docs'),
            file('login.puml', '@startuml\nA -> B\n@enduml'),
            file('circle.svg', svg),
        ]);
        assert.deepEqual(
            results.map((r) => r.status),
            ['done', 'done', 'done'],
        );
        const md = (await api('GET', `/api/files/${results[0]?.fileId as string}`, { token })).json;
        assert.equal(md.name, 'notes.md');
        assert.equal(md.categoryPath.join('/'), 'Docs');
        const content = await fetch(`${base}/api/files/${results[1]?.fileId as string}/content`, {
            headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(await content.text(), '@startuml\nA -> B\n@enduml');
        assert.equal(
            content.headers.get('content-security-policy'),
            "default-src 'none'; sandbox",
            'served without scripts',
        );
    });

    it('refuses kinds that a browser would run, broken or dangerous SVG, and empty files', async () => {
        const { token } = await registerOwner();
        const results = await written(token, [
            file('page.html', '<h1>x</h1>'),
            file('run.js', 'alert(1)'),
            file('noext', 'text'),
            file(
                'evil.svg',
                '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            ),
            file(
                'click.svg',
                '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="alert(1)" width="1" height="1"/></svg>',
            ),
            file(
                'remote.svg',
                '<svg xmlns="http://www.w3.org/2000/svg"><image href="http://evil.example/x.png"/></svg>',
            ),
        ]);
        const more = await written(token, [
            file('half.svg', '<svg><circle'),
            file('empty.md', ' '),
            file('ghost.md', 'text', 'Nowhere'),
        ]);
        assert.deepEqual(
            [...results, ...more].map((r) => r.status),
            Array(9).fill('skipped'),
        );
        assert.equal(
            ((await api('GET', '/api/files?limit=5', { token })).json.files as unknown[]).length,
            0,
        );
    });

    it('judges SVG on its own', () => {
        assert.equal(
            svgProblem('<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"><path d="M0 0L1 1"/></svg>'),
            null,
        );
        assert.notEqual(
            svgProblem('<svg><a href="javascript:alert(1)"><text>x</text></a></svg>'),
            null,
        );
        assert.notEqual(
            svgProblem('<svg><foreignObject><body onload="x()"/></foreignObject></svg>'),
            null,
        );
        assert.notEqual(
            svgProblem('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>'),
            null,
        );
        assert.equal(svgProblem('<svg><image href="data:image/png;base64,AAAA"/></svg>'), null);
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

describe('the assistant finding pictures and filing them', () => {
    /** A stand-in for apps/vision that turns every description into the same unit vector. */
    let vision: Server;
    let textEmbedding = 0;
    const unit = (axis: number, tilt = 0): string =>
        `[${Array.from({ length: 512 }, (_, i) => (i === axis ? 1 : i === axis + 1 ? tilt : 0)).join(',')}]`;
    let realUrl: string | undefined;

    before(async () => {
        vision = createServer((req, res) => {
            req.resume();
            req.on('end', () => {
                res.setHeader('content-type', 'application/json');
                res.end(
                    JSON.stringify({
                        embedding: JSON.parse(unit(textEmbedding)),
                    }),
                );
            });
        });
        await new Promise<void>((resolve) => vision.listen(0, '127.0.0.1', resolve));
        realUrl = config.vision.url;
        config.vision.url = `http://127.0.0.1:${String((vision.address() as AddressInfo).port)}`;
    });
    after(() => {
        config.vision.url = realUrl;
        vision.close();
    });

    async function pictures(token: string): Promise<{ near: string; also: string; far: string }> {
        const ids: string[] = [];
        for (const n of [11, 12, 13])
            ids.push(
                (await upload(token, `p${String(n)}.png`, await png(n))).json.file.id as string,
            );
        const db = getPool();
        const vectors = [unit(0), unit(0, 0.2), unit(5)];
        for (const [i, id] of ids.entries())
            await db.query('UPDATE files SET embedding = $2::vector WHERE id = $1', [
                id,
                vectors[i],
            ]);
        return { near: ids[0] as string, also: ids[1] as string, far: ids[2] as string };
    }

    it('finds what looks like the description, waits for the yes, then files exactly those pictures', async () => {
        const { token } = await registerOwner();
        const { near, also, far } = await pictures(token);
        textEmbedding = 0;
        next = turn('Found some.', [act('add_matching', 'Dogs', { phrase: 'a dog' })]);
        const events = await talk(token, 'put the dogs into Dogs');
        const message = events.at(-1)?.data.message as {
            id: number;
            actions: { status: string; fileIds: string[]; categoryId: number }[];
        };
        const card = message.actions[0];
        assert.equal(card?.status, 'pending');
        assert.equal(
            (events.at(-1)?.data.message as { content: string }).content,
            'I found 2 pictures for Dogs. Look at them below and confirm to file them; nothing has moved yet.',
            'the sentence comes from what was found, not from what the model guessed',
        );
        assert.deepEqual([...(card?.fileIds ?? [])].sort(), [near, also].sort());

        const filedBefore = (await api('GET', `/api/files/${near}`, { token })).json;
        assert.equal(filedBefore.categoryId, null, 'nothing moved before the yes');

        const done = await api('POST', `/api/chat/messages/${String(message.id)}/actions/0`, {
            token,
            body: { decision: 'confirm' },
        });
        assert.equal(done.json.action.status, 'done');
        for (const id of [near, also])
            assert.equal(
                (await api('GET', `/api/files/${id}`, { token })).json.categoryId,
                card?.categoryId,
            );
        assert.equal(
            (await api('GET', `/api/files/${far}`, { token })).json.categoryId,
            null,
            'the unrelated picture stays where it was',
        );
    });

    it('says so when nothing looks like the description, and makes no folder for it', async () => {
        const { token } = await registerOwner();
        await pictures(token);
        textEmbedding = 40;
        next = turn('Looking.', [act('add_matching', 'Cats', { phrase: 'a cat' })]);
        const events = await talk(token, 'find cats');
        const action = (events.at(-1)?.data.message as { actions: { status: string }[] })
            .actions[0];
        assert.equal(action?.status, 'skipped');
        const tree = (await api('GET', '/api/categories', { token })).json.categories as unknown[];
        assert.equal(tree.length, 0);
    });
});

describe('the assistant answering a plain yes or no, and not claiming what it did not do', () => {
    async function waitingUnsort(token: string): Promise<{ id: number }> {
        const cat = (
            await api('POST', '/api/categories', { token, body: { name: 'Pics', parentId: null } })
        ).json.id as number;
        const id = (await upload(token, 'a.png', await png(31))).json.file.id as string;
        await api('PATCH', `/api/files/${id}`, { token, body: { categoryId: cat } });
        next = turn('Confirm below.', [act('unsort_all')]);
        const events = await talk(token, 'unsort everything');
        return events.at(-1)?.data.message as { id: number };
    }
    const categoryOfFirst = async (token: string): Promise<number | null> =>
        (await api('GET', '/api/files?limit=5', { token })).json.files[0].categoryId as
            number | null;

    it('a typed "yes" confirms the card that waits, exactly like the button', async () => {
        const { token } = await registerOwner();
        await waitingUnsort(token);
        assert.notEqual(await categoryOfFirst(token), null, 'nothing changed before the yes');
        next = turn('this must not be asked of the model', []);
        const events = await talk(token, 'Yes');
        assert.equal(await categoryOfFirst(token), null, 'the file is unsorted now');
        assert.equal((events.at(-1)?.data.message as { content: string }).content, 'Done.');
        const history = (await api('GET', '/api/chat', { token })).json.messages as {
            actions: { status: string }[];
        }[];
        assert.equal(history.find((m) => m.actions.length > 0)?.actions[0]?.status, 'done');
    });

    it('a typed "no" leaves everything as it was', async () => {
        const { token } = await registerOwner();
        await waitingUnsort(token);
        const events = await talk(token, 'no');
        assert.notEqual(await categoryOfFirst(token), null);
        assert.equal(
            (events.at(-1)?.data.message as { content: string }).content,
            'Left as it is.',
        );
    });

    it('a "yes" with nothing waiting says so instead of inventing an answer', async () => {
        const { token } = await registerOwner();
        const events = await talk(token, 'yes');
        assert.equal(
            (events.at(-1)?.data.message as { content: string }).content,
            'Nothing is waiting for a yes right now.',
        );
    });

    it('does not repeat a claim that something was done when no action was listed', async () => {
        const { token } = await registerOwner();
        next = turn('I found 66 pictures related to mountains and moved them to Nature.', []);
        const events = await talk(token, 'put the mountains into nature');
        const said = (events.at(-1)?.data.message as { content: string }).content;
        assert.match(said, /^I have not changed anything yet/);
        next = turn('Documents was made earlier, so it is already there.', []);
        const plain = await talk(token, 'is there a documents folder?');
        assert.match(
            (plain.at(-1)?.data.message as { content: string }).content,
            /^Documents was made earlier/,
            'an ordinary answer is left alone',
        );
    });

    it('tells the model how many files wait in the review queue', async () => {
        const { token } = await registerOwner();
        await upload(token, 'r.png', await png(32));
        await getPool().query("UPDATE files SET status = 'review'");
        next = turn('ok', []);
        await talk(token, 'how many files are in review?');
        assert.match(seenPrompt, /review queue[^\n]*: 1\./);
    });
});
