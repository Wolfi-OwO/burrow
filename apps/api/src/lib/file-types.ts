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

const CONDITIONS: Record<Exclude<FileType, 'other'>, string> = {
    image: `f.mime LIKE 'image/%'`,
    audio: `f.mime LIKE 'audio/%'`,
    video: `f.mime LIKE 'video/%'`,
    archive: `(${NAME('zip|7z|rar|tar|gz|tgz|bz2|xz')} OR f.mime IN ('application/zip', 'application/x-zip-compressed'))`,
    spreadsheet: NAME('xlsx|xlsm|xls|xlt|ods|csv|tsv'),
    presentation: NAME('pptx|pptm|ppt|pps|odp'),
    code: NAME(
        'json|jsonl|xml|ya?ml|toml|ini|js|mjs|cjs|ts|tsx|jsx|py|java|kt|c|h|cpp|hpp|cs|go|rs|rb|php|sh|bash|zsh|sql|css|scss|html?|svg|swift|lua|r|pl|dart|gradle|vue|svelte|ipynb',
    ),
    route: NAME('gpx|tcx|kml|geojson'),
    document: '',
};

// Source and route files often arrive as text/*, which would also make them documents; the name wins.
CONDITIONS.document = `(${NAME('pdf|docx|docm|doc|dot|odt|rtf|txt|md|markdown|epub')} OR f.mime = 'application/pdf' OR f.mime LIKE 'text/%') AND NOT (${CONDITIONS.code} OR ${CONDITIONS.route})`;

const ALL = Object.values(CONDITIONS);

/** @returns The SQL condition for one kind of file; "other" is everything the named kinds do not claim. */
export function typeCondition(type: FileType): string {
    return type === 'other' ? `NOT (${ALL.join(' OR ')})` : CONDITIONS[type];
}

/** Archives the drive can unpack itself. */
export const ZIP_CONDITION = `f.name ~* '\\.zip$'`;
