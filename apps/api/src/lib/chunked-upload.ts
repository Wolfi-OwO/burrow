import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { mkdir, open, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { Readable } from 'node:stream';

import { config } from '../config/index.ts';
import { BadRequestError, NotFoundError, ForbiddenError } from './errors.ts';

/**
 * Big files arrive in pieces. The file is pre-allocated once and every piece is written at its own offset, in any
 * order and several at a time, so there is no reassembly step: when the last piece lands the file is already whole.
 * A dropped connection costs one piece, and the page can ask which pieces arrived and carry on.
 */
const root = join(config.storage.dir, 'tmp', 'uploads');
mkdirSync(root, { recursive: true });

const STALE_MS = 24 * 3_600_000;

interface Meta {
    userId: string;
    name: string;
    mime: string;
    size: number;
    chunkBytes: number;
    chunks: number;
    categoryId: number | null;
    /** What the page sends to recognise the same file again (size and last-modified time); older sessions have none. */
    fingerprint?: string;
}

/** What starting an upload answers: the pieces that are already here are listed, so the page sends only the rest. */
export interface UploadSession {
    id: string;
    chunkBytes: number;
    chunks: number;
    received: number[];
}

/** Every session id is a uuid. */
const SESSION_ID = /^[0-9a-f-]{36}$/;

/**
 * The folder of one session, found by looking for it in the uploads folder. The path is built from the name on disk,
 * never from the id in the request, so nothing a client sends can reach outside the folder.
 */
async function dirOf(id: string): Promise<string> {
    const found = (await readdir(root)).find((entry) => entry === id && SESSION_ID.test(entry));
    if (found === undefined) throw new NotFoundError('Upload not found.');
    return join(root, found);
}

const readMeta = async (dir: string): Promise<Meta> =>
    JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as Meta;

/** The session with this id if it is this account's: its folder and what it was announced as. */
async function sessionOf(userId: string, id: string): Promise<{ dir: string; meta: Meta }> {
    const dir = await dirOf(id);
    let meta: Meta;
    try {
        meta = await readMeta(dir);
    } catch {
        throw new NotFoundError('Upload not found.');
    }
    if (meta.userId !== userId) throw new ForbiddenError('That upload is not yours.');
    return { dir, meta };
}

/** The pieces of one session that have fully arrived (each has a marker file written after its last byte). */
async function receivedIn(dir: string): Promise<number[]> {
    return (await readdir(dir))
        .map((f) => /^chunk-(\d+)\.ok$/.exec(f)?.[1])
        .filter((n): n is string => n !== undefined)
        .map(Number)
        .sort((a, b) => a - b);
}

/**
 * The unfinished session of this account for the same file, if there is one: the same name, size, folder and
 * fingerprint. When a crash or a second try left several, the one with the most pieces wins.
 */
async function findResumable(
    userId: string,
    input: { name: string; size: number; categoryId: number | null; fingerprint: string },
): Promise<{ dir: string; session: UploadSession } | null> {
    let best: { dir: string; session: UploadSession } | null = null;
    for (const entry of await readdir(root)) {
        if (!SESSION_ID.test(entry)) continue;
        const dir = join(root, entry);
        let meta: Meta;
        try {
            meta = await readMeta(dir);
        } catch {
            continue;
        }
        if (
            meta.userId !== userId ||
            meta.fingerprint !== input.fingerprint ||
            meta.name !== input.name ||
            meta.size !== input.size ||
            meta.categoryId !== input.categoryId
        )
            continue;
        const received = await receivedIn(dir);
        if (!best || received.length > best.session.received.length)
            best = {
                dir,
                session: { id: entry, chunkBytes: meta.chunkBytes, chunks: meta.chunks, received },
            };
    }
    return best;
}

export const chunkedUpload = {
    async start(
        userId: string,
        input: {
            name: string;
            mime: string;
            size: number;
            categoryId: number | null;
            fingerprint?: string;
        },
    ): Promise<UploadSession> {
        if (input.size > config.maxFileBytes)
            throw new BadRequestError('The file is larger than the upload limit.');
        if (input.fingerprint) {
            const again = await findResumable(userId, { ...input, fingerprint: input.fingerprint });
            if (again) {
                // Resuming counts as activity, so the hourly sweep does not remove it half way.
                const now = new Date();
                await utimes(again.dir, now, now);
                return again.session;
            }
        }
        const id = randomUUID();
        const dir = join(root, id);
        const chunkBytes = config.uploadChunkBytes;
        const chunks = Math.max(1, Math.ceil(input.size / chunkBytes));
        await mkdir(dir, { recursive: true });
        const data = await open(join(dir, 'data'), 'w');
        try {
            await data.truncate(input.size);
        } finally {
            await data.close();
        }
        const meta: Meta = { userId, ...input, chunkBytes, chunks };
        await writeFile(join(dir, 'meta.json'), JSON.stringify(meta));
        return { id, chunkBytes, chunks, received: [] };
    },

    /** Which pieces have arrived, so an interrupted upload resumes instead of starting over. */
    async received(userId: string, id: string): Promise<{ chunks: number; received: number[] }> {
        const { dir, meta } = await sessionOf(userId, id);
        return { chunks: meta.chunks, received: await receivedIn(dir) };
    },

    /** Streams one piece to its place in the file. The length must be exactly what that piece should hold. */
    async write(userId: string, id: string, index: number, body: Readable): Promise<void> {
        const { dir, meta } = await sessionOf(userId, id);
        if (!Number.isInteger(index) || index < 0 || index >= meta.chunks)
            throw new BadRequestError('No such piece.');
        const start = index * meta.chunkBytes;
        const expected = Math.min(meta.chunkBytes, meta.size - start);
        let seen = 0;
        const guard = new Transform({
            transform(chunk: Buffer, _encoding, done) {
                seen += chunk.length;
                done(
                    seen > expected
                        ? new BadRequestError('The piece is larger than expected.')
                        : null,
                    chunk,
                );
            },
        });
        await pipeline(body, guard, createWriteStream(join(dir, 'data'), { flags: 'r+', start }));
        if (seen !== expected) throw new BadRequestError('The piece is shorter than expected.');
        await writeFile(join(dir, `chunk-${String(index)}.ok`), '');
    },

    /** Checks that every piece arrived and hands over the finished file; the caller owns (and removes) it. */
    async finish(
        userId: string,
        id: string,
    ): Promise<{
        path: string;
        size: number;
        name: string;
        mime: string;
        categoryId: number | null;
    }> {
        const { dir, meta } = await sessionOf(userId, id);
        const received = await receivedIn(dir);
        if (received.length !== meta.chunks)
            throw new BadRequestError(
                `${String(meta.chunks - received.length)} pieces are still missing.`,
            );
        const path = join(dir, 'data');
        const { size } = await stat(path);
        if (size !== meta.size)
            throw new BadRequestError('The file is not the size it was announced with.');
        return { path, size, name: meta.name, mime: meta.mime, categoryId: meta.categoryId };
    },

    async discard(id: string): Promise<void> {
        const dir = await dirOf(id).catch(() => null);
        if (dir) await rm(dir, { recursive: true, force: true });
    },

    /** Drops uploads nobody finished (closed tab, lost connection), so they cannot fill the disk. */
    async sweep(): Promise<void> {
        for (const entry of await readdir(root)) {
            if (!SESSION_ID.test(entry)) continue;
            const dir = join(root, entry);
            const info = await stat(dir).catch(() => null);
            if (info && Date.now() - info.mtimeMs > STALE_MS)
                await rm(dir, { recursive: true, force: true });
        }
    },
};

/** Starts the hourly sweep; returns a function that stops it. */
export function startUploadSweep(): () => void {
    void chunkedUpload.sweep();
    const timer = setInterval(() => void chunkedUpload.sweep(), 3_600_000);
    timer.unref();
    return () => clearInterval(timer);
}
