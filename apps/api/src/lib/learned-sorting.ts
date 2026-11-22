import { config } from '../config/index.ts';
import type { Category } from '../models/category.model.ts';

/**
 * Learning from what the person decided by hand (sorting_examples). The picture model scores a picture against folder
 * names it only half understands, so it is wrong in ways that are specific to one person's folders. The pictures the
 * person has already filed themselves are better evidence than any wording: a new picture that looks like three of
 * them belongs next to them.
 *
 * A neighbour is one of those examples near the new picture in embedding space. The more of them there are, and the
 * closer, the more the folder they sit in is trusted over the zero-shot score; with none the zero-shot score is
 * used unchanged, so a new account sorts exactly as before.
 */
export interface Neighbour {
    categoryId: number;
    /** Cosine similarity between the example's picture and the new one (1 = the same picture). */
    similarity: number;
}

export interface Learned {
    neighbours: Neighbour[];
    /** Every folder's parent, so an example filed deep in a branch counts for the branch being decided. */
    parentOf: Map<number, number | null>;
}

/** 0 at the similarity floor, 1 for the same picture: how much one example counts. */
export function weightOf(similarity: number, floor = config.sorting.learnMinSimilarity): number {
    return Math.min(1, Math.max(0, (similarity - floor) / (1 - floor)));
}

/** The candidate that holds `categoryId`: the folder itself or the nearest ancestor among the candidates. */
function holder(
    categoryId: number,
    candidates: Set<number>,
    parentOf: Map<number, number | null>,
): number | null {
    let current: number | null = categoryId;
    for (let depth = 0; current !== null && depth < 64; depth++) {
        if (candidates.has(current)) return current;
        current = parentOf.get(current) ?? null;
    }
    return null;
}

/**
 * How the examples vote at one level of the tree.
 *
 * @returns `share`: each candidate's part of the total weight (they sum to 1), and `strength`: 0..1, how much evidence
 *   there is at all. Examples that sit outside every candidate's branch are not part of this vote.
 */
export function learnedShare(
    learned: Learned,
    candidates: Category[],
    fullWeight = config.sorting.learnFullWeight,
): { share: Map<number, number>; strength: number } {
    const ids = new Set(candidates.map((c) => c.id));
    const weights = new Map<number, number>();
    let total = 0;
    for (const n of learned.neighbours) {
        const w = weightOf(n.similarity);
        const owner = w > 0 ? holder(n.categoryId, ids, learned.parentOf) : null;
        if (owner === null) continue;
        weights.set(owner, (weights.get(owner) ?? 0) + w);
        total += w;
    }
    const share = new Map<number, number>();
    for (const [id, w] of weights) share.set(id, w / total);
    return { share, strength: Math.min(1, total / fullWeight) };
}

/** The zero-shot score and the learned share, weighted by how much evidence there is (never fully replaced). */
export function blend(
    zeroShot: number,
    share: number,
    strength: number,
    maxTrust = config.sorting.learnMaxTrust,
): number {
    const trust = maxTrust * strength;
    return (1 - trust) * zeroShot + trust * share;
}
