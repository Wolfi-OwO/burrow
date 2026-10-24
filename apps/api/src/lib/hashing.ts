import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/**
 * Streams a file through SHA-256, so a multi-GB upload never sits in memory.
 *
 * @param path - Absolute or relative path of the staged file.
 * @returns The lowercase hex digest.
 */
export async function sha256File(path: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) {
        hash.update(chunk as Buffer);
    }
    return hash.digest('hex');
}
