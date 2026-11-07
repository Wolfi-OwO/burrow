import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { config } from '../../src/config/index.ts';
import { checkTarget, downloadTo, isPublicAddress, LinkRefused } from '../../src/lib/safe-fetch.ts';
import { importService } from '../../src/services/import-service.ts';
import { api, closeServer, registerOwner, resetDatabase, zipOf } from '../helpers.ts';

after(closeServer);

describe('which addresses a link may reach', () => {
    it('refuses every private, loopback, link-local and reserved address, in every spelling', () => {
        for (const address of [
            '127.0.0.1',
            '127.1.2.3',
            '10.0.0.1',
            '172.16.5.5',
            '172.31.255.255',
            '192.168.1.1',
            '169.254.169.254', // the cloud metadata address
            '100.64.0.1',
            '0.0.0.0',
            '224.0.0.1',
            '255.255.255.255',
            '::1',
            '::',
            'fe80::1',
            'fc00::1',
            'fd12:3456::1',
            '::ffff:127.0.0.1', // IPv4-mapped loopback
            '::ffff:7f00:1', // the same address in hex
            '::ffff:10.0.0.1',
            '64:ff9b::7f00:1', // NAT64 wrapping loopback
            '2002:7f00:1::1', // 6to4 wrapping loopback
            'not an address',
        ])
            assert.equal(isPublicAddress(address), false, address);
    });

    it('accepts ordinary public addresses', () => {
        for (const address of [
            '8.8.8.8',
            '1.1.1.1',
            '93.184.216.34',
            '2606:4700:4700::1111',
            '::ffff:8.8.8.8',
        ])
            assert.equal(isPublicAddress(address), true, address);
    });

    it('refuses links to this machine, the docker network and odd spellings before connecting', async () => {
        for (const link of [
            'http://127.0.0.1/',
            'http://localhost/',
            'http://localhost.localdomain/',
            'http://[::1]/',
            'http://169.254.169.254/latest/meta-data/',
            'http://10.0.0.5/secret',
            'http://2130706433/', // 127.0.0.1 as one decimal number
            'http://0x7f.0.0.1/',
            'http://0177.0.0.1/',
            'http://[::ffff:127.0.0.1]/',
        ])
            await assert.rejects(checkTarget(link), LinkRefused, link);
    });

    it('refuses other schemes, other ports and credentials in the link', async () => {
        await assert.rejects(checkTarget('ftp://example.com/a'), /http and https/);
        await assert.rejects(checkTarget('file:///etc/passwd'), /http and https/);
        await assert.rejects(checkTarget('gopher://example.com/'), /http and https/);
        await assert.rejects(checkTarget('http://example.com:8080/a'), /standard web ports/);
        await assert.rejects(checkTarget('http://user:pw@example.com/a'), /user name/);
        await assert.rejects(checkTarget('nonsense'), /not a valid link/);
    });
});

/** A tiny web server standing in for "the internet", on this machine (allowed only while a test says so). */
let web: Server;
let base: string;
let handler: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => res.end();
const dir = await mkdtemp(join(tmpdir(), 'burrow-import-'));

before(async () => {
    web = createServer((req, res) => handler(req, res)).listen(0, '127.0.0.1');
    await new Promise((resolve) => web.once('listening', resolve));
    base = `http://127.0.0.1:${String((web.address() as AddressInfo).port)}`;
});
after(() => {
    web.closeAllConnections();
    web.close();
});
beforeEach(() => {
    config.importUrl.allowPrivate = true;
});
afterEach(() => {
    config.importUrl.allowPrivate = false;
    config.importUrl.maxBytes = 10 * 1024 * 1024 * 1024;
    config.importUrl.maxPerUser = 2;
});

const options = { maxBytes: 1024 * 1024, allowPrivate: true };

describe('downloading a link', () => {
    it('stores the bytes and takes the name from the server, else from the path', async () => {
        handler = (req, res) => {
            res.setHeader('content-type', 'text/plain; charset=utf-8');
            if (req.url?.startsWith('/named'))
                res.setHeader('content-disposition', 'attachment; filename="from-header.txt"');
            res.end('hello from the web');
        };
        const named = await downloadTo(`${base}/named?x=1`, join(dir, 'a'), options);
        assert.equal(named.name, 'from-header.txt');
        assert.equal(named.mime, 'text/plain');
        assert.equal(named.size, 18);
        assert.equal(await readFile(named.path, 'utf8'), 'hello from the web');
        const plain = await downloadTo(`${base}/files/My%20Holiday.txt`, join(dir, 'b'), options);
        assert.equal(plain.name, 'My Holiday.txt');
    });

    it('follows redirects, and stops at a loop', async () => {
        handler = (req, res) => {
            if (req.url === '/start') {
                res.writeHead(302, { location: '/end' }).end();
            } else if (req.url === '/end') {
                res.end('arrived');
            } else {
                res.writeHead(302, { location: req.url ?? '/' }).end();
            }
        };
        assert.equal((await downloadTo(`${base}/start`, join(dir, 'c'), options)).size, 7);
        await assert.rejects(
            downloadTo(`${base}/loop`, join(dir, 'd'), options),
            /redirects too many times/,
        );
    });

    it('checks every redirect again: a hop to another scheme or to a private address is refused', async () => {
        handler = (_req, res) => void res.writeHead(302, { location: 'file:///etc/passwd' }).end();
        await assert.rejects(downloadTo(`${base}/x`, join(dir, 'e'), options), /http and https/);
        // The same hop with the guard on: this machine itself is not a place a link may lead.
        handler = (_req, res) => void res.writeHead(302, { location: `${base}/inner` }).end();
        await assert.rejects(
            downloadTo(`${base}/x`, join(dir, 'f'), { ...options, allowPrivate: false }),
            /private or internal|standard web ports/,
        );
    });

    it('refuses a file over the size limit, announced or not, and an error status', async () => {
        handler = (_req, res) => void res.end(Buffer.alloc(5000, 1));
        await assert.rejects(
            downloadTo(`${base}/big`, join(dir, 'g'), { ...options, maxBytes: 1000 }),
            /larger than the import limit/,
        );
        // No Content-Length (chunked): the running count has to catch it.
        handler = (_req, res) => {
            res.write(Buffer.alloc(2000, 1));
            setTimeout(() => res.end(Buffer.alloc(2000, 1)), 20);
        };
        await assert.rejects(
            downloadTo(`${base}/chunked`, join(dir, 'h'), { ...options, maxBytes: 3000 }),
            /larger than the import limit/,
        );
        handler = (_req, res) => void res.writeHead(404).end('nope');
        await assert.rejects(
            downloadTo(`${base}/missing`, join(dir, 'i'), options),
            /error \(404\)/,
        );
        handler = (_req, res) => void res.writeHead(200).end();
        await assert.rejects(downloadTo(`${base}/empty`, join(dir, 'j'), options), /empty file/);
    });

    it('gives a generic message when the connection fails, without saying where it tried', async () => {
        await assert.rejects(
            downloadTo('http://127.0.0.1:1/x', join(dir, 'k'), options),
            (error: Error) =>
                error instanceof LinkRefused &&
                error.message === 'Could not download from that link.',
        );
    });
});

describe('importing a link into the drive', () => {
    beforeEach(resetDatabase);

    it('answers 202 with a job and the file lands in the drive, in the chosen folder', async () => {
        const owner = await registerOwner();
        const folder = (
            await api('POST', '/api/categories', {
                token: owner.token,
                body: { name: 'Docs', parentId: null },
            })
        ).json.id as number;
        handler = (_req, res) => {
            res.setHeader('content-type', 'text/csv');
            res.end('a,b\n1,2\n');
        };
        const reply = await api('POST', '/api/imports', {
            token: owner.token,
            body: { url: `${base}/data/table.csv`, categoryId: folder },
        });
        assert.equal(reply.status, 202);
        assert.match(reply.json.job as string, /^[0-9a-f-]{36}$/);
        for (let i = 0; i < 50; i++) {
            const files = (await api('GET', '/api/files', { token: owner.token })).json.files as {
                name: string;
                categoryId: number | null;
            }[];
            const found = files.find((f) => f.name === 'table.csv');
            if (found) {
                assert.equal(found.categoryId, folder);
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.fail('the imported file never showed up');
    });

    it('unpacks a zip from a link like an uploaded one', async () => {
        const owner = await registerOwner();
        const zip = Buffer.from(
            await zipOf([
                { name: 'one.txt', data: Buffer.from('1') },
                { name: 'two.txt', data: Buffer.from('22') },
            ]).arrayBuffer(),
        );
        handler = (_req, res) => void res.end(zip);
        const { done } = await importService.start(owner.id, {
            url: `${base}/bundle.zip`,
            categoryId: null,
        });
        await done;
        const names = (
            (await api('GET', '/api/files', { token: owner.token })).json.files as {
                name: string;
            }[]
        )
            .map((f) => f.name)
            .sort();
        assert.deepEqual(names, ['one.txt', 'two.txt']);
    });

    it('refuses a private address in the request itself, with a 400 and a reason', async () => {
        const owner = await registerOwner();
        config.importUrl.allowPrivate = false;
        for (const url of [
            'http://127.0.0.1/',
            'http://169.254.169.254/latest/meta-data/',
            'http://localhost/x',
            'ftp://example.com/a',
        ]) {
            const reply = await api('POST', '/api/imports', { token: owner.token, body: { url } });
            assert.equal(reply.status, 400, url);
            assert.match(reply.json.message as string, /private|internal|http and https/);
        }
    });

    it('needs a signed-in account and a sane request', async () => {
        assert.equal(
            (await api('POST', '/api/imports', { body: { url: `${base}/x` } })).status,
            401,
        );
        const owner = await registerOwner();
        assert.equal(
            (await api('POST', '/api/imports', { token: owner.token, body: {} })).status,
            400,
        );
        assert.equal(
            (
                await api('POST', '/api/imports', {
                    token: owner.token,
                    body: { url: 'x'.repeat(3000) },
                })
            ).status,
            400,
        );
        assert.equal(
            (
                await api('POST', '/api/imports', {
                    token: owner.token,
                    body: { url: `${base}/x`, extra: 1 },
                })
            ).status,
            400,
        );
    });

    it('limits how many links one account downloads at once', async () => {
        const owner = await registerOwner();
        config.importUrl.maxPerUser = 1;
        handler = () => undefined; // never answers: the first import stays busy
        const first = await importService.start(owner.id, {
            url: `${base}/slow`,
            categoryId: null,
        });
        const second = await api('POST', '/api/imports', {
            token: owner.token,
            body: { url: `${base}/another` },
        });
        assert.equal(second.status, 429);
        web.closeAllConnections();
        await first.done; // the dropped connection ends it, and frees the slot
        handler = (_req, res) => void res.end('ok');
        assert.equal(
            (
                await api('POST', '/api/imports', {
                    token: owner.token,
                    body: { url: `${base}/third` },
                })
            ).status,
            202,
        );
    });

    it('can be switched off', async () => {
        const owner = await registerOwner();
        config.importUrl.enabled = false;
        try {
            assert.equal(
                (
                    await api('POST', '/api/imports', {
                        token: owner.token,
                        body: { url: `${base}/x` },
                    })
                ).status,
                403,
            );
        } finally {
            config.importUrl.enabled = true;
        }
    });
});
