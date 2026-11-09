export interface Account {
    id: string;
    username: string;
    displayName: string;
    bio: string;
    hasAvatar: boolean;
    hasPassword: boolean;
    role: string;
    nsfwOptIn: boolean;
}

export interface CategoryNode {
    id: number;
    parentId: number | null;
    name: string;
    path: string;
    depth: number;
    fileCount: number;
    publicPreview: boolean;
}

export type FileStatus = 'unsorted' | 'sorted' | 'review';

export interface FileItem {
    id: string;
    name: string;
    mime: string;
    size: number;
    status: FileStatus;
    categoryId: number | null;
    categoryPath: string[];
    suggestedCategoryId: number | null;
    suggestedName?: string | null;
    confidence: number | null;
    nsfwScore: number | null;
    createdAt: string;
    rank?: number;
    latitude?: number | null;
    longitude?: number | null;
    place?: string | null;
    placeScore?: number | null;
    takenAt?: string | null;
}

export interface SortingStatus {
    backlog: number;
    categories: number;
    runsPerDay: number;
    intervalMinutes: number;
    lastRunAt: string | null;
    visionConfigured: boolean;
    visionHealthy: boolean;
    autoFileThreshold: number;
}

export interface Identity {
    provider: 'github' | 'google' | 'microsoft';
    email: string | null;
}

export interface ShareUser {
    id: string;
    username: string;
    displayName: string;
}

export type ShareAccess = 'link' | 'users';

/** A folder inside a shared folder, as a link's public page lists it. */
export interface SharedFolder {
    id: number;
    name: string;
    fileCount: number;
}

export interface Share {
    id: string;
    token: string;
    kind: 'file' | 'category' | 'drive';
    targetId: string | number;
    name: string;
    owner: string;
    access: ShareAccess;
    expiresAt: string | null;
    revoked: boolean;
    expired: boolean;
    createdAt: string;
    users: ShareUser[];
}

/** The absolute address of a share link, built from where the app is served. */
export function shareUrl(token: string): string {
    return `${window.location.origin}/s/${token}`;
}

export interface DuplicateGroup {
    id: string;
    keepId: string;
    files: FileItem[];
}

/** The kinds the drive can be filtered by; the key is what the API's `type` parameter takes. */
export const FILE_KINDS: { key: string; label: string }[] = [
    { key: 'image', label: 'Pictures' },
    { key: 'document', label: 'Documents' },
    { key: 'spreadsheet', label: 'Spreadsheets' },
    { key: 'presentation', label: 'Presentations' },
    { key: 'code', label: 'Code' },
    { key: 'route', label: 'Routes' },
    { key: 'archive', label: 'Archives' },
    { key: 'audio', label: 'Audio' },
    { key: 'video', label: 'Video' },
    { key: 'other', label: 'Other' },
];

/** One thing the assistant did, or proposes to do and waits for a yes on, shown as a card under its message. */
export interface ChatAction {
    type:
        | 'create_category'
        | 'rename_category'
        | 'add_hint'
        | 'add_matching'
        | 'unsort_category'
        | 'unsort_all'
        | 'remove_category'
        | 'remove_all_categories'
        | 'create_file';
    status: 'done' | 'exists' | 'skipped' | 'pending' | 'declined';
    label: string;
    detail?: string;
    categoryId?: number;
    /** The pictures a pending or finished add_matching card is about. */
    fileIds?: string[];
    fileId?: string;
    mime?: string;
}

export interface ChatMessage {
    id: number;
    role: 'user' | 'assistant';
    content: string;
    actions: ChatAction[];
    createdAt: string;
}
