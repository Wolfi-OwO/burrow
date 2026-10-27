import type { Category } from '../models/category.model.ts';
import { typeOfFile } from './file-types.ts';
import type { FileType } from './file-types.ts';

/** Folder names that mean a whole kind of file, in lower case. */
const KIND_NAMES: Partial<Record<FileType, string[]>> = {
    document: ['document', 'documents', 'docs', 'text', 'texts'],
    spreadsheet: ['spreadsheet', 'spreadsheets', 'excel', 'tables'],
    presentation: ['presentation', 'presentations', 'slides', 'powerpoint'],
    code: ['code', 'source', 'sources', 'source code', 'scripts', 'programming'],
    route: ['route', 'routes', 'gps', 'tracks', 'maps', 'trails'],
    archive: ['archive', 'archives', 'zip', 'zips', 'compressed'],
    audio: ['audio', 'music', 'sounds', 'songs'],
    video: ['video', 'videos', 'movies', 'clips'],
};

const SAME_EXT: Record<string, string> = { jpeg: 'jpg', htm: 'html', yml: 'yaml', markdown: 'md' };

const canon = (ext: string): string => SAME_EXT[ext] ?? ext;

/** "DOCX", ".docx", "docx files" and "DOCX-Files" all name the extension docx. */
const folderExt = (name: string): string =>
    canon(
        name
            .trim()
            .toLowerCase()
            .replace(/^\./, '')
            .replace(/[\s_-]*(files?|dateien)$/, ''),
    );

const depth = (c: Category): number => c.path.split('.').length;

/**
 * The folder a file belongs to by its type alone, when the user made one for it: a folder named after the extension
 * (DOCX, GPX) wins over one named after the kind (Documents, Routes); the deeper folder wins a tie. Pictures are only
 * filed by an extension folder, because what is in them is the picture model's job. Null when nothing matches.
 */
export function folderForFile(
    file: { name: string; mime: string },
    categories: Category[],
): Category | null {
    const kind = typeOfFile(file.name, file.mime);
    const ext = canon(/\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? '');
    const deepest = (list: Category[]): Category | null =>
        list.sort((a, b) => depth(b) - depth(a))[0] ?? null;
    const byExt = ext ? categories.filter((c) => folderExt(c.name) === ext) : [];
    if (byExt.length > 0) return deepest(byExt);
    if (kind === 'image' || kind === 'other') return null;
    const names = KIND_NAMES[kind] ?? [];
    return deepest(categories.filter((c) => names.includes(c.name.trim().toLowerCase())));
}
