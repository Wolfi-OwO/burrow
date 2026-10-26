export interface Account {
    id: string;
    username: string;
    displayName: string;
    bio: string;
    hasAvatar: boolean;
    hasPassword: boolean;
    role: string;
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

export interface Share {
    id: string;
    token: string;
    kind: 'file' | 'category';
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
