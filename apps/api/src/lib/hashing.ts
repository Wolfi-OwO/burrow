import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { resolve, sep } from 'node:path';

import { config } from '../config/index.ts';

/**
 * Streams a file through SHA-256, so a multi-GB upload never sits in memory.
 *
 * @param path - Absolute or relative path of the staged file.
 * @returns The lowercase hex digest.
 */
export async function sha256File(path: string): Promise<string> {
    const safe = resolve(path);
    if (!safe.startsWith(resolve(config.storage.dir) + sep))
        throw new Error('Path is outside its folder.');
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(safe)) {
        hash.update(chunk as Buffer);
    }
    return hash.digest('hex');
}
