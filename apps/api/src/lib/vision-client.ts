import { openAsBlob } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

import { config } from '../config/index.ts';
import { currentTraceId, TRACE_HEADER } from './trace.ts';

/** One zero-shot label with its probability among the labels asked about. */
export interface LabelScore {
    label: string;
    score: number;
}

/** The shared secret between the two services; without it a vision service that has a token answers 401. */
function serviceHeaders(): Record<string, string> {
    const traceId = currentTraceId();
    return {
        ...(config.vision.serviceToken
            ? { 'X-Internal-Service-Token': config.vision.serviceToken }
            : {}),
        // The same id on the other side, so a slow or failed call can be followed from the request that caused it.
        ...(traceId ? { [TRACE_HEADER]: traceId } : {}),
    };
}

/** Pictures up to this size are read into memory before sending, so nothing is read from the disk while the request runs. */
const BUFFER_LIMIT = 64 * 1024 * 1024;

/**
 * The file as something fetch can send. A file-backed Blob is read lazily while the request runs; if the request is
 * cut off at that moment (a timeout, a vision service that restarts) the failed read is thrown outside any promise and
 * stopped the whole process once. Buffering what fits avoids that; only a huge file stays lazy.
 */
async function pictureBlob(file: string): Promise<Blob> {
    if ((await stat(file)).size <= BUFFER_LIMIT) return new Blob([await readFile(file)]);
    return openAsBlob(file);
}

async function post<T>(
    path: string,
    file: string,
    fields: Record<string, string> = {},
): Promise<T> {
    if (!config.vision.url) throw new Error('VISION_SERVICE_URL is not set.');
    const form = new FormData();
    form.append('file', await pictureBlob(file), basename(file));
    for (const [key, value] of Object.entries(fields)) form.append(key, value);

    const response = await fetch(new URL(path, config.vision.url), {
        method: 'POST',
        body: form,
        headers: serviceHeaders(),
        signal: AbortSignal.timeout(config.vision.timeoutMs),
    });
    if (!response.ok) throw new Error(`vision ${path} answered ${String(response.status)}`);
    return (await response.json()) as T;
}

export const visionClient = {
    /** @returns The 512-dim OpenCLIP ViT-B/32 embedding of an image (FR-032). */
    async embed(file: string): Promise<number[]> {
        return (await post<{ embedding: number[] }>('/embed', file)).embedding;
    },

    /**
     * Zero-shot classification against the user's own category names (FR-033).
     *
     * @param labels - Candidate names; each gets a probability, not only the winner (FR-034).
     */
    async classify(file: string, labels: string[]): Promise<LabelScore[]> {
        return (
            await post<{ scores: LabelScore[] }>('/classify', file, {
                labels: JSON.stringify(labels),
            })
        ).scores;
    },

    /** @returns The probability that an image is NSFW (FR-036), from its own dedicated model. */
    async nsfw(file: string): Promise<number> {
        return (await post<{ nsfw: number }>('/nsfw', file)).nsfw;
    },

    /** @returns Whether apps/vision answers its health check. */
    async isHealthy(): Promise<boolean> {
        if (!config.vision.url) return false;
        try {
            const response = await fetch(new URL('/health', config.vision.url), {
                signal: AbortSignal.timeout(3000),
            });
            return response.ok;
        } catch {
            return false;
        }
    },
};
