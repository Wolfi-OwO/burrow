/**
 * A category called "SFW" or "NSFW" is a rating, not a subject: no picture model can tell those words apart from the
 * picture, but the dedicated NSFW classifier can, so these levels are decided by its score instead of by the
 * zero-shot labels.
 */
export type Rating = 'safe' | 'explicit';

const EXPLICIT = /^(nsfw|explicit|adult|18\+|xxx)$/i;
const SAFE = /^(sfw|safe|clean|family)$/i;

/** SQL regular expressions (case-insensitive) for the same two groups, so queries and code cannot disagree. */
export const EXPLICIT_SQL = '^(nsfw|explicit|adult|18\\+|xxx)$';
export const SAFE_SQL = '^(sfw|safe|clean|family)$';

/** @returns The rating a category name stands for, or null for an ordinary subject. */
export function ratingOf(name: string): Rating | null {
    const trimmed = name.trim();
    if (EXPLICIT.test(trimmed)) return 'explicit';
    if (SAFE.test(trimmed)) return 'safe';
    return null;
}
