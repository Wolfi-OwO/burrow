import { config } from '../config/index.ts';
import { blobStore } from '../lib/blob-store.ts';
import { logger } from '../lib/logger.ts';
import { visionClient } from '../lib/vision-client.ts';
import type { Category } from '../models/category.model.ts';
import type { FileRecord } from '../models/file.model.ts';
import { categoryRepository } from '../repository/category.repository.ts';
import { fileRepository } from '../repository/file.repository.ts';

/** The competitor label at every level, so a single category cannot win just by being the only one (probabilities sum to 1). */
const NONE_OF_THESE = 'something else';

/** What the descent decided for one file. */
export interface Decision {
    status: 'sorted' | 'review' | 'unsorted';
    category: Category | null;
    confidence: number | null;
}

/**
 * The descent of FR-038/FR-039, separated from I/O so it can be tested with a fake scorer.
 *
 * Level by level: score the children against each other and "something else"; descend into the winner while
 * it clears the threshold, and stop at the current level when no child does. If not even a top-level category
 * clears it, the best guess goes to review (FR-043).
 *
 * @param children - Returns the direct children of a node (null = top level).
 * @param score - Returns each label's probability for the file.
 * @param threshold - The named auto-file threshold (FR-035).
 */
export async function descend(
    children: (parentId: number | null) => Promise<Category[]>,
    score: (labels: string[]) => Promise<{ label: string; score: number }[]>,
    threshold: number,
): Promise<Decision> {
    let current: Category | null = null;
    let confidence: number | null = null;
    let parentId: number | null = null;

    for (;;) {
        const candidates = await children(parentId);
        if (candidates.length === 0) break;

        const scores = await score([...candidates.map((c) => c.name), NONE_OF_THESE]);
        const best = candidates
            .map((c) => ({
                category: c,
                score: scores.find((s) => s.label === c.name)?.score ?? 0,
            }))
            .sort((a, b) => b.score - a.score)[0];
        if (!best) break;

        if (best.score < threshold) {
            if (current === null)
                return { status: 'review', category: best.category, confidence: best.score };
            break;
        }
        current = best.category;
        confidence = best.score;
        parentId = best.category.id;
    }

    return current
        ? { status: 'sorted', category: current, confidence }
        : { status: 'unsorted', category: null, confidence: null };
}

export const classificationService = {
    /**
     * Classifies one file against its owner's live category tree and records the outcome. Failure
     * to reach the vision service leaves the file untouched, so the next run retries it.
     *
     * @returns The decision, or null when the file could not be processed this time.
     */
    async classify(file: FileRecord): Promise<Decision | null> {
        if (!file.mime.startsWith('image/')) {
            // Nothing to look at: mark it seen so it is not retried forever.
            await fileRepository.setClassification(file.id, {
                status: 'unsorted',
                categoryId: null,
                suggestedCategoryId: null,
                confidence: null,
                nsfwScore: null,
                embedding: null,
            });
            return { status: 'unsorted', category: null, confidence: null };
        }

        try {
            const path = await blobStore.ensureLocal(file.blobSha256);
            const [embedding, nsfw] = await Promise.all([
                visionClient.embed(path),
                visionClient.nsfw(path),
            ]);
            const decision = await descend(
                (parentId) => categoryRepository.listChildren(file.userId, parentId),
                (labels) => visionClient.classify(path, labels),
                config.sorting.autoFileThreshold,
            );

            // FR-037: an NSFW file never auto-files into a category that may sit behind a preview link.
            const gated =
                decision.status === 'sorted' &&
                nsfw >= config.sorting.nsfwThreshold &&
                decision.category?.publicPreview === true;
            const final: Decision = gated
                ? { status: 'review', category: decision.category, confidence: decision.confidence }
                : decision;

            await fileRepository.setClassification(file.id, {
                status: final.status,
                categoryId: final.status === 'sorted' ? (final.category?.id ?? null) : null,
                suggestedCategoryId:
                    final.status === 'review' ? (final.category?.id ?? null) : null,
                confidence: final.confidence,
                nsfwScore: nsfw,
                embedding,
            });
            return final;
        } catch (error) {
            logger.warn(
                { err: error, fileId: file.id },
                'classification failed; will retry next run',
            );
            return null;
        }
    },
};
