import type { CategoryNode } from './types.ts';

/** One line of the category list: the empty choice first, then every folder in tree order. */
export interface CategoryRow {
    value: string;
    label: string;
    depth: number;
    /** "Private / Furry / NSFW": what the line is, in full, for a tooltip. */
    path: string;
}

/** @returns The lines of the list. `categories` must be in tree order (a parent before its children), as the API sends them. */
export function categoryRows(
    categories: readonly Pick<CategoryNode, 'id' | 'name' | 'depth'>[],
    emptyLabel: string,
): CategoryRow[] {
    const names: string[] = [];
    return [
        { value: '', label: emptyLabel, depth: 0, path: emptyLabel },
        ...categories.map((c) => {
            names.length = c.depth;
            names[c.depth] = c.name;
            return { value: String(c.id), label: c.name, depth: c.depth, path: names.join(' / ') };
        }),
    ];
}

export interface Box {
    left: number;
    top: number;
    bottom: number;
    width: number;
}

export interface Placement {
    left: number;
    top: number;
    width: number;
    maxHeight: number;
    above: boolean;
}

const MARGIN = 8;
const MIN_WIDTH = 280;
const MAX_HEIGHT = 360;
const ROOM_WANTED = 220;

/**
 * Where the list opens so that all of it is on the screen: as wide as the button but at least wide enough for a long
 * name, pulled back in from the right edge, and below the button unless there is clearly more room above it.
 */
export function placeList(box: Box, viewportWidth: number, viewportHeight: number): Placement {
    const width = Math.min(Math.max(box.width, MIN_WIDTH), viewportWidth - 2 * MARGIN);
    const left = Math.min(Math.max(MARGIN, box.left), viewportWidth - width - MARGIN);
    const below = viewportHeight - box.bottom - MARGIN;
    const above = box.top - MARGIN;
    const flip = below < ROOM_WANTED && above > below;
    return {
        left,
        width,
        above: flip,
        top: flip ? box.top - 4 : box.bottom + 4,
        maxHeight: Math.max(120, Math.min(MAX_HEIGHT, (flip ? above : below) - 4)),
    };
}

/** @returns The index of the next line whose label starts with what has been typed, searching from `from` and wrapping. */
export function typeAhead(rows: readonly CategoryRow[], typed: string, from: number): number {
    const wanted = typed.toLowerCase();
    for (let step = 0; step < rows.length; step += 1) {
        const index = (from + step) % rows.length;
        if (rows[index]?.label.toLowerCase().startsWith(wanted)) return index;
    }
    return -1;
}
