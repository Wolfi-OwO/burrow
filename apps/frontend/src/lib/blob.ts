import { useEffect, useState } from 'react';

import { fetchBlob } from './api.ts';

/**
 * Object URLs by API path, so scrolling back through a grid does not refetch every thumbnail.
 *
 * The mistake this replaces: the cache dropped its oldest entry past a limit and revoked that object URL even when a
 * picture on screen was still showing it. A review list of a few hundred files kept all its rows mounted, so the top rows
 * turned into broken images as soon as the cache filled. An entry is now only revoked when no mounted component uses it.
 */
interface Entry {
    promise: Promise<string | null>;
    users: number;
}
const cache = new Map<string, Entry>();
const MAX_CACHED = 400;

/** A few thumbnails at a time: hundreds of simultaneous requests starve the page and trip the per-IP rate limit. */
const MAX_PARALLEL = 6;
let running = 0;
const waiting: (() => void)[] = [];

async function slot<T>(work: () => Promise<T>): Promise<T> {
    if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
    running += 1;
    try {
        return await work();
    } finally {
        running -= 1;
        waiting.shift()?.();
    }
}

async function fetchWithRetry(path: string): Promise<string | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            return URL.createObjectURL(await slot(() => fetchBlob(path)));
        } catch {
            // One more try after a short pause: a busy server or a dropped connection usually clears at once.
            await new Promise((resolve) => setTimeout(resolve, 600));
        }
    }
    return null;
}

function evict(): void {
    for (const [key, entry] of cache) {
        if (cache.size <= MAX_CACHED) return;
        if (entry.users > 0) continue;
        void entry.promise.then((url) => url && URL.revokeObjectURL(url));
        cache.delete(key);
    }
}

function acquire(path: string): Entry {
    let entry = cache.get(path);
    if (!entry) {
        const fresh: Entry = { promise: fetchWithRetry(path), users: 0 };
        entry = fresh;
        cache.set(path, fresh);
        // A failed load is not kept, so the next time the picture is shown it is asked for again.
        void fresh.promise.then((url) => {
            if (url === null && cache.get(path) === fresh) cache.delete(path);
        });
    }
    entry.users += 1;
    return entry;
}

function release(path: string): void {
    const entry = cache.get(path);
    if (!entry) return;
    entry.users = Math.max(0, entry.users - 1);
    evict();
}

/** @returns An object URL for a protected image path, or null while loading or when there is none. */
export function useProtectedImage(path: string | null): string | null {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        let live = true;
        setUrl(null);
        if (!path) return undefined;
        const entry = acquire(path);
        void entry.promise.then((value) => live && setUrl(value));
        return () => {
            live = false;
            release(path);
        };
    }, [path]);
    return url;
}

/** Forgets one cached image (after an avatar change, for instance). */
export function forgetImage(path: string): void {
    const entry = cache.get(path);
    if (!entry) return;
    void entry.promise.then((url) => url && URL.revokeObjectURL(url));
    cache.delete(path);
}
