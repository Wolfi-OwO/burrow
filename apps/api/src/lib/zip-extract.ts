import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import yauzl from 'yauzl';

export interface ZipLimits {
    /** Entries looked at before the rest is ignored, so a zip of a million tiny files cannot tie up the server. */
    maxEntries: number;
    /** Largest single file; counted while streaming, never taken from the entry header. */
    maxEntryBytes: number;
    /** Everything extracted from one archive together: the zip-bomb bound. */
    maxTotalBytes: number;
}

export interface ZipSummary {
    extracted: number;
    skipped: number;
}

const SKIPPED_NAME = /^(\.|__MACOSX)/;

class LimitExceeded extends Error {}

/** Stops a stream once it carries more than `max` bytes. */
function cap(max: number, onBytes: (n: number) => void): Transform {
    let seen = 0;
    return new Transform({
        transform(chunk: Buffer, _encoding, done) {
            seen += chunk.length;
            onBytes(chunk.length);
            done(seen > max ? new LimitExceeded('entry too large') : null, chunk);
        },
    });
}

/**
 * Reads a zip entry by entry and hands each regular file to `onFile` as a staged temp file. Folders, hidden files,
 * macOS resource forks, entries over the size cap and nested paths are reduced to their base name or skipped; nothing
 * is ever written to a path taken from the archive, so there is no path traversal to guard against.
 *
 * @param archive - The staged zip.
 * @param stagingDir - Where each extracted file is written before `onFile` takes it over (and removes it).
 * @param limits - Entry count and size bounds.
 * @param onFile - Receives the staged file, its size and its base name; must delete or move the staged file.
 */
export function extractZip(
    archive: string,
    stagingDir: string,
    limits: ZipLimits,
    onFile: (path: string, size: number, name: string) => Promise<void>,
): Promise<ZipSummary> {
    return new Promise((resolve, reject) => {
        yauzl.open(archive, { lazyEntries: true, autoClose: true }, (openError, zip) => {
            if (openError) return reject(openError);
            const summary: ZipSummary = { extracted: 0, skipped: 0 };
            let entries = 0;
            let total = 0;
            let n = 0;

            const finish = (): void => resolve(summary);
            const next = (): void => zip.readEntry();

            zip.on('end', finish);
            zip.on('error', reject);
            zip.on('entry', (entry: yauzl.Entry) => {
                entries += 1;
                const name = basename(entry.fileName);
                if (
                    entries > limits.maxEntries ||
                    entry.fileName.endsWith('/') ||
                    SKIPPED_NAME.test(name) ||
                    entry.fileName.split('/').some((part) => part === '__MACOSX')
                ) {
                    summary.skipped += 1;
                    return next();
                }
                zip.openReadStream(entry, (streamError, stream) => {
                    if (streamError) {
                        summary.skipped += 1;
                        return next();
                    }
                    n += 1;
                    const staged = join(stagingDir, `zip-${String(Date.now())}-${String(n)}`);
                    let size = 0;
                    pipeline(
                        stream,
                        cap(limits.maxEntryBytes, (bytes) => {
                            size += bytes;
                            total += bytes;
                            if (total > limits.maxTotalBytes)
                                throw new LimitExceeded('archive too large');
                        }),
                        createWriteStream(staged),
                    ).then(
                        async () => {
                            await onFile(staged, size, name);
                            summary.extracted += 1;
                            next();
                        },
                        async (error: unknown) => {
                            await rm(staged, { force: true });
                            // Over the cap or unreadable: this entry is skipped, the rest of the archive still counts.
                            if (error instanceof LimitExceeded && total > limits.maxTotalBytes) {
                                zip.close();
                                return finish();
                            }
                            summary.skipped += 1;
                            next();
                        },
                    );
                });
            });
            next();
        });
    });
}
