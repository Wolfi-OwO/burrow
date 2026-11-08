import { resolve, sep } from 'node:path';

/**
 * Proves a path lies inside `root` before anything reads, writes or removes it.
 *
 * Every staged upload, unpacked zip entry and cached blob lives under the storage folder, so a path that points
 * anywhere else is a bug or an attack and must stop here instead of reaching the file system.
 *
 * @returns The absolute, normalised path.
 * @throws {Error} When the path is outside `root`.
 */
export function within(root: string, candidate: string): string {
    const base = resolve(root);
    const full = resolve(candidate);
    if (full !== base && !full.startsWith(base + sep))
        throw new Error('Path is outside its folder.');
    return full;
}
