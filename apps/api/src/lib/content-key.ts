import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

import yauzl from 'yauzl';

/** Texts bigger than this are left to the byte hash; reading them whole would cost more than a duplicate is worth. */
const MAX_TEXT_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 5000;

const TEXT_EXT =
    /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|ya?ml|toml|ini|js|mjs|cjs|ts|tsx|jsx|py|java|kt|c|h|cpp|hpp|cs|go|rs|rb|php|sh|sql|css|scss|html?|svg|gpx|tcx|kml|geojson|tex|log|rtf)$/i;
const ZIP_EXT = /\.(zip|docx|docm|xlsx|xlsm|pptx|pptm|odt|ods|odp|epub)$/i;
const OFFICE_EXT = /\.(docx|docm|xlsx|xlsm|pptx|pptm)$/i;

export type KeyKind = 'text' | 'zip' | null;

/** Which way of reading a file's content applies, decided from its name and type alone (no file access). */
export function keyKind(name: string, mime: string): KeyKind {
    if (ZIP_EXT.test(name)) return 'zip';
    if (TEXT_EXT.test(name) || mime.startsWith('text/') || mime === 'application/json')
        return 'text';
    return null;
}

const digest = (prefix: string, text: string): string =>
    prefix + createHash('sha256').update(text).digest('hex');

/** The words of a text without its line endings, byte-order mark and trailing blanks. */
export function normalizeText(text: string): string {
    return text
        .replace(/^\uFEFF/u, '')
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/, ''))
        .join('\n')
        .replace(/\n+$/, '');
}

function zipEntries(path: string): Promise<string[] | null> {
    return new Promise((resolve) => {
        yauzl.open(path, { lazyEntries: true, autoClose: true }, (error, zip) => {
            if (error) return resolve(null);
            const lines: string[] = [];
            zip.on('entry', (entry: yauzl.Entry) => {
                if (lines.length >= MAX_ZIP_ENTRIES) return zip.close();
                if (!entry.fileName.endsWith('/'))
                    lines.push(`${entry.fileName}\t${entry.crc32}\t${entry.uncompressedSize}`);
                zip.readEntry();
            });
            zip.on('end', () => resolve(lines.length < MAX_ZIP_ENTRIES ? lines : null));
            zip.on('error', () => resolve(null));
            zip.readEntry();
        });
    });
}

/**
 * A key that two files share when they say the same thing, whatever bytes carry it.
 *
 * - Texts and code: the content with line endings, a BOM and trailing blanks normalised.
 * - Zip-based files (zip, Office, OpenDocument, EPUB): the list of names, checksums and sizes inside, so saving a
 *   document again or re-zipping a folder does not make a new one. Office keeps the author and save time in
 *   `docProps/`, which is left out.
 *
 * @returns The key, or null when the file has no content-based identity and the byte hash is all there is.
 */
export async function contentKey(path: string, name: string, mime: string): Promise<string | null> {
    const kind = keyKind(name, mime);
    if (kind === 'text') {
        if ((await stat(path)).size > MAX_TEXT_BYTES) return null;
        const bytes = await readFile(path);
        if (bytes.includes(0)) return null;
        return digest('txt:', normalizeText(bytes.toString('utf8')));
    }
    if (kind === 'zip') {
        const entries = await zipEntries(path);
        if (!entries || entries.length === 0) return null;
        const kept = OFFICE_EXT.test(name)
            ? entries.filter((line) => !line.startsWith('docProps/'))
            : entries;
        return digest('zip:', [...kept].sort().join('\n'));
    }
    return null;
}
