import { join, sep } from 'node:path';

import type { Response } from 'express';

/** Vite puts a content hash in every file name under assets/, so a changed file is always a new URL. */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Everything else (index.html, the icon, small scripts) keeps its name across releases, so it must be asked about every
 * time. "no-cache" does not mean "do not store": the browser keeps the file and sends its ETag, and the server answers
 * 304 with no body, so a visit after a deploy picks up the new hashed file names at once and costs almost nothing.
 */
export const REVALIDATE = 'no-cache';

/** Options for express.static that give hashed assets a year and everything else a revalidation. */
export function staticCache(root: string): {
    index: false;
    setHeaders: (res: Response, filePath: string) => void;
} {
    const assets = join(root, 'assets') + sep;
    return {
        index: false,
        setHeaders: (res, filePath) => {
            res.setHeader('Cache-Control', filePath.startsWith(assets) ? IMMUTABLE : REVALIDATE);
        },
    };
}
