export type FileStatus = 'unsorted' | 'sorted' | 'review';

/** File metadata. The bytes live in the blob store under `blobSha256`. */
export interface FileRecord {
    id: string;
    userId: string;
    blobSha256: string;
    name: string;
    mime: string;
    size: number;
    categoryId: number | null;
    status: FileStatus;
    suggestedCategoryId: number | null;
    confidence: number | null;
    nsfwScore: number | null;
    classifiedAt: Date | null;
    createdAt: Date;
}

/** A file together with its human-readable location in the tree. */
export interface FileView extends FileRecord {
    /** Category names from the root down, joined from the ltree's surrogate ids (ADR-0003). */
    categoryPath: string[];
    /** ts_rank, only present on search results. */
    rank?: number;
}
