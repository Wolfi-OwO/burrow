/** The kinds the drive can be filtered by, each as a SQL condition on a file row (alias `f`). */
export const FILE_TYPES = [
    'image',
    'document',
    'spreadsheet',
    'presentation',
    'code',
    'route',
    'archive',
    'audio',
    'video',
    'other',
] as const;
export type FileType = (typeof FILE_TYPES)[number];

const NAME = (re: string): string => `f.name ~* '\\.(${re})$'`;

/** Extensions per kind, written once for the SQL filter and for the sorter that files by type. */
const EXT = {
    archive: 'zip|7z|rar|tar|gz|tgz|bz2|xz',
    spreadsheet: 'xlsx|xlsm|xls|xlt|ods|csv|tsv',
    presentation: 'pptx|pptm|ppt|pps|odp',
    code: 'json|jsonl|xml|ya?ml|toml|ini|js|mjs|cjs|ts|tsx|jsx|py|java|kt|c|h|cpp|hpp|cs|go|rs|rb|php|sh|bash|zsh|sql|css|scss|html?|svg|swift|lua|r|pl|dart|gradle|vue|svelte|ipynb',
    route: 'gpx|tcx|kml|geojson',
    document: 'pdf|docx|docm|doc|dot|odt|rtf|txt|md|markdown|epub',
};

const CONDITIONS: Record<Exclude<FileType, 'other'>, string> = {
    image: `f.mime LIKE 'image/%'`,
    audio: `f.mime LIKE 'audio/%'`,
    video: `f.mime LIKE 'video/%'`,
    archive: `(${NAME(EXT.archive)} OR f.mime IN ('application/zip', 'application/x-zip-compressed'))`,
    spreadsheet: NAME(EXT.spreadsheet),
    presentation: NAME(EXT.presentation),
    code: NAME(EXT.code),
    route: NAME(EXT.route),
    document: '',
};

// Source and route files often arrive as text/*, which would also make them documents; the name wins.
CONDITIONS.document = `(${NAME(EXT.document)} OR f.mime = 'application/pdf' OR f.mime LIKE 'text/%') AND NOT (${CONDITIONS.code} OR ${CONDITIONS.route})`;

/** The same decision as the SQL filter, for one file in memory. */
export function typeOfFile(name: string, mime: string): FileType {
    const n = name.toLowerCase();
    const has = (re: string): boolean => new RegExp(`\\.(${re})$`).test(n);
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    if (has(EXT.archive) || mime === 'application/zip' || mime === 'application/x-zip-compressed')
        return 'archive';
    if (has(EXT.spreadsheet)) return 'spreadsheet';
    if (has(EXT.presentation)) return 'presentation';
    if (has(EXT.code)) return 'code';
    if (has(EXT.route)) return 'route';
    if (has(EXT.document) || mime === 'application/pdf' || mime.startsWith('text/'))
        return 'document';
    return 'other';
}

const ALL = Object.values(CONDITIONS);

/** @returns The SQL condition for one kind of file; "other" is everything the named kinds do not claim. */
export function typeCondition(type: FileType): string {
    return type === 'other' ? `NOT (${ALL.join(' OR ')})` : CONDITIONS[type];
}

/** Archives the drive can unpack itself. */
export const ZIP_CONDITION = `f.name ~* '\\.zip$'`;
