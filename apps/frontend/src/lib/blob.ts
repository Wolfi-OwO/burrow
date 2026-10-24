import { useEffect, useState } from 'react';

import { fetchBlob } from './api.ts';

/** Object URLs by API path, so scrolling back through a grid does not refetch every thumbnail. */
const cache = new Map<string, Promise<string | null>>();
const MAX_CACHED = 400;

function load(path: string): Promise<string | null> {
    let entry = cache.get(path);
    if (!entry) {
        entry = fetchBlob(path).then(
            (blob) => URL.createObjectURL(blob),
            () => null,
        );
        cache.set(path, entry);
        if (cache.size > MAX_CACHED) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) {
                void cache.get(oldest)?.then((url) => url && URL.revokeObjectURL(url));
                cache.delete(oldest);
            }
        }
    }
    return entry;
}

/** @returns An object URL for a protected image path, or null while loading or when there is none. */
export function useProtectedImage(path: string | null): string | null {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        let live = true;
        setUrl(null);
        if (path) void load(path).then((value) => live && setUrl(value));
        return () => {
            live = false;
        };
    }, [path]);
    return url;
}

/** Forgets one cached image (after an avatar change, for instance). */
export function forgetImage(path: string): void {
    void cache.get(path)?.then((url) => url && URL.revokeObjectURL(url));
    cache.delete(path);
}
