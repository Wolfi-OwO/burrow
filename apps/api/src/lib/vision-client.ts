import { openAsBlob } from 'node:fs';
import { basename } from 'node:path';

import { config } from '../config/index.ts';

/** One zero-shot label with its probability among the labels asked about. */
export interface LabelScore {
    label: string;
    score: number;
}

/** The shared secret between the two services; without it a vision service that has a token answers 401. */
function serviceHeaders(): Record<string, string> {
    return config.vision.serviceToken
        ? { 'X-Internal-Service-Token': config.vision.serviceToken }
        : {};
}

async function post<T>(
    path: string,
    file: string,
    fields: Record<string, string> = {},
): Promise<T> {
    if (!config.vision.url) throw new Error('VISION_SERVICE_URL is not set.');
    const form = new FormData();
    form.append('file', await openAsBlob(file), basename(file));
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
