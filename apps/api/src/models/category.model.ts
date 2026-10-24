/** A node of the user's category tree. `path` is the ltree of surrogate ids (ADR-0003), never names. */
export interface Category {
    id: number;
    userId: string;
    parentId: number | null;
    name: string;
    path: string;
    publicPreview: boolean;
}

/** A category plus what the tree UI needs to render it without a second query. */
export interface CategoryNode extends Category {
    depth: number;
    fileCount: number;
}
