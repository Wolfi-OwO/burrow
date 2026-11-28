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
    other: ['other', 'misc', 'miscellaneous', 'various'],
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
/** The folder name offered for a kind that has none yet. */
export const KIND_FOLDER_NAME: Record<FileType, string> = {
    image: 'Pictures',
    document: 'Documents',
    spreadsheet: 'Spreadsheets',
    presentation: 'Presentations',
    code: 'Code',
    route: 'Routes',
    archive: 'Archives',
    audio: 'Audio',
    video: 'Video',
    other: 'Other',
};

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
    if (kind === 'image') return null;
    const names = KIND_NAMES[kind] ?? [];
    return deepest(categories.filter((c) => names.includes(c.name.trim().toLowerCase())));
}

/** Kinds of folder a picture never belongs in, whatever the picture model thinks the folder name looks like. */
const NOT_FOR_PICTURES: FileType[] = ['video', 'audio', 'archive', 'route'];

/** "Media" and friends mean moving pictures and sound too, which KIND_NAMES keeps under video and audio. */
const MOVING_OR_SOUND_EXT = new Set(
    'mp4 mov mkv avi webm m4v wmv flv mpg mpeg 3gp mp3 wav flac ogg m4a aac opus wma'.split(' '),
);

const MEDIA_NAMES = ['media', 'film', 'films', 'footage', 'recordings', 'movie', 'tv', 'shows'];

/**
 * False for a folder that holds another kind of file: Video, Movies, Media, Audio, Archives, Routes, or one named
 * after such an extension (MP4, ZIP, GPX). The picture model scores a folder by its name, so a JPG of a film poster
 * could win "Movies"; the sorter leaves those folders out of the choice for pictures.
 */
export function acceptsPictures(category: Category): boolean {
    const name = category.name.trim().toLowerCase();
    if (MEDIA_NAMES.includes(name)) return false;
    for (const kind of NOT_FOR_PICTURES) if (KIND_NAMES[kind]?.includes(name)) return false;
    const ext = folderExt(name);
    if (!/^[a-z0-9]{2,5}$/.test(ext)) return true;
    return !MOVING_OR_SOUND_EXT.has(ext) && !NOT_FOR_PICTURES.includes(typeOfFile(`x.${ext}`, ''));
}
