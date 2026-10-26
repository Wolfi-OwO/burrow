import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
}

const dirOf = (id: string): string => join(root, id);

async function metaOf(userId: string, id: string): Promise<Meta> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundError('Upload not found.');
    let meta: Meta;
    try {
        meta = JSON.parse(await readFile(join(dirOf(id), 'meta.json'), 'utf8')) as Meta;
    } catch {
        throw new NotFoundError('Upload not found.');
    }
    if (meta.userId !== userId) throw new ForbiddenError('That upload is not yours.');
    return meta;
}

export const chunkedUpload = {
    async start(
        userId: string,
        input: { name: string; mime: string; size: number; categoryId: number | null },
    ): Promise<{ id: string; chunkBytes: number; chunks: number }> {
        if (input.size > config.maxFileBytes)
            throw new BadRequestError('The file is larger than the upload limit.');
        const id = randomUUID();
        const chunkBytes = config.uploadChunkBytes;
        const chunks = Math.max(1, Math.ceil(input.size / chunkBytes));
        await mkdir(dirOf(id), { recursive: true });
        const data = await open(join(dirOf(id), 'data'), 'w');
        try {
            await data.truncate(input.size);
        } finally {
            await data.close();
        }
        const meta: Meta = { userId, ...input, chunkBytes, chunks };
        await writeFile(join(dirOf(id), 'meta.json'), JSON.stringify(meta));
        return { id, chunkBytes, chunks };
    },

    /** Which pieces have arrived, so an interrupted upload resumes instead of starting over. */
    async received(userId: string, id: string): Promise<{ chunks: number; received: number[] }> {
        const meta = await metaOf(userId, id);
        const files = await readdir(dirOf(id));
        const received = files
            .map((f) => /^chunk-(\d+)\.ok$/.exec(f)?.[1])
            .filter((n): n is string => n !== undefined)
            .map(Number)
            .sort((a, b) => a - b);
        return { chunks: meta.chunks, received };
    },

    /** Streams one piece to its place in the file. The length must be exactly what that piece should hold. */
    async write(userId: string, id: string, index: number, body: Readable): Promise<void> {
        const meta = await metaOf(userId, id);
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
        await pipeline(
            body,
            guard,
            createWriteStream(join(dirOf(id), 'data'), { flags: 'r+', start }),
        );
        if (seen !== expected) throw new BadRequestError('The piece is shorter than expected.');
        await writeFile(join(dirOf(id), `chunk-${String(index)}.ok`), '');
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
        const meta = await metaOf(userId, id);
        const { received } = await chunkedUpload.received(userId, id);
        if (received.length !== meta.chunks)
            throw new BadRequestError(
                `${String(meta.chunks - received.length)} pieces are still missing.`,
            );
        const path = join(dirOf(id), 'data');
        const { size } = await stat(path);
        if (size !== meta.size)
            throw new BadRequestError('The file is not the size it was announced with.');
        return { path, size, name: meta.name, mime: meta.mime, categoryId: meta.categoryId };
    },

    async discard(id: string): Promise<void> {
        await rm(dirOf(id), { recursive: true, force: true });
    },

    /** Drops uploads nobody finished (closed tab, lost connection), so they cannot fill the disk. */
    async sweep(): Promise<void> {
        for (const id of await readdir(root)) {
            const info = await stat(dirOf(id)).catch(() => null);
            if (info && Date.now() - info.mtimeMs > STALE_MS) await chunkedUpload.discard(id);
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
