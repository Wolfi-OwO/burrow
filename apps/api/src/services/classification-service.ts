import { sniffMime } from '../lib/sniff.ts';
import { folderForFile } from '../lib/type-folders.ts';
import { config } from '../config/index.ts';
import { blobStore } from '../lib/blob-store.ts';
import { logger } from '../lib/logger.ts';
import { PLACE_MIN_SCORE, PLACES } from '../lib/places.ts';
import { ratingOf } from '../lib/rating.ts';
import { visionClient } from '../lib/vision-client.ts';
import type { Category } from '../models/category.model.ts';
import type { FileRecord } from '../models/file.model.ts';
import { categoryRepository } from '../repository/category.repository.ts';
import { fileRepository } from '../repository/file.repository.ts';

/**
 * Competitor labels at every level, so a category cannot win just by being one of the few the user has made
 * (probabilities sum to 1): a thermometer must not become "Furry" because nothing else was on offer. A competitor
 * whose wording contains one of the user's own category names is left out, so "Food" is not outvoted by "food".
 */
const COMPETITORS = [
    'something else',
    'an everyday object',
    'a person',
    'a screenshot',
    'a text document',
    'food',
    'a room or building',
];

/**
 * Words the picture model reads poorly on their own, with phrasings it knows. Matched against a folder's name in
 * lower case; every folder also gets two generic phrasings (an artwork of it, an illustration of it), because much of
 * what people file is drawn, not photographed.
 */
const ALIASES: Record<string, string[]> = {
    furry: [
        'an anthropomorphic animal character',
        'furry fandom artwork',
        'a fursona character with fur and a tail',
    ],
    wolf: ['a wolf', 'an anthropomorphic wolf character'],
    fox: ['a fox', 'an anthropomorphic fox character'],
    dragon: ['a dragon', 'an anthropomorphic dragon character'],
    anime: ['an anime character', 'manga artwork'],
    cartoon: ['a cartoon character', 'a comic strip'],
    meme: ['an internet meme image with text', 'a funny image macro'],
    screenshot: ['a screenshot of an app or a website'],
    nature: [
        'a landscape with trees and plants',
        'wildlife in nature',
        'a mountain landscape',
        'a hiker on a mountain summit',
        'a view over mountains and valleys',
        'a photo taken outdoors in nature',
    ],
    documents: ['a photo or scan of a paper document', 'a page of text, a form or a table'],
    food: ['a plate of food', 'a meal on a table'],
};

/** Every phrasing a folder is scored under; its score is the sum over them, as they all say the same thing. */
export function labelsFor(name: string): string[] {
    const aliases = ALIASES[name.trim().toLowerCase()] ?? [];
    return [name, `${name} artwork`, `an illustration of ${name}`, ...aliases];
}

function competitorsFor(candidates: Category[]): string[] {
    const names = candidates.map((c) => c.name.toLowerCase().replace(/s$/, ''));
    return COMPETITORS.filter((label) => !names.some((n) => n.length > 2 && label.includes(n)));
}

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
 * @param nsfw - The NSFW classifier's probability. A level whose children are all ratings (SFW / NSFW) is decided by
 *   it, not by the zero-shot labels; a score in the grey zone between the two goes to review instead of being guessed.
 * @param reviewFloor - A best guess below this is not worth a review item: the file simply stays unsorted.
 */
export async function descend(
    children: (parentId: number | null) => Promise<Category[]>,
    score: (labels: string[]) => Promise<{ label: string; score: number }[]>,
    threshold: number,
    nsfw: number | null = null,
    reviewFloor = 0.3,
): Promise<Decision> {
    let current: Category | null = null;
    let confidence: number | null = null;
    let parentId: number | null = null;

    for (;;) {
        const candidates = await children(parentId);
        if (candidates.length === 0) break;

        if (nsfw !== null && candidates.every((c) => ratingOf(c.name) !== null)) {
            const wanted = nsfw >= 0.5 ? 'explicit' : 'safe';
            const match = candidates.find((c) => ratingOf(c.name) === wanted);
            const sure = wanted === 'explicit' ? nsfw : 1 - nsfw;
            // No category for this rating (only "SFW" exists, the file is explicit): stop here rather than mis-file it.
            if (!match) break;
            if (sure < threshold) {
                if (current === null)
                    return { status: 'review', category: match, confidence: sure };
                break;
            }
            // The rating is settled; anything below it (SFW > Wolves) is still decided by the labels.
            current = match;
            confidence = sure;
            parentId = match.id;
            continue;
        }

        const scores = await score([
            ...candidates.flatMap((c) => labelsFor(c.name)),
            ...competitorsFor(candidates),
        ]);
        const best = candidates
            .map((c) => ({
                category: c,
                score: Math.min(
                    1,
                    labelsFor(c.name).reduce(
                        (sum, label) => sum + (scores.find((s) => s.label === label)?.score ?? 0),
                        0,
                    ),
                ),
            }))
            .sort((a, b) => b.score - a.score)[0];
        if (!best) break;

        if (best.score < threshold) {
            // Close enough to be worth a look: review. Far off, nothing the user made fits: it stays in Unsorted.
            if (current === null && best.score >= reviewFloor)
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

/** The most likely landmark or kind of scene, or no guess when nothing on the list clearly wins. */
async function guessPlace(path: string): Promise<{ place: string | null; score: number | null }> {
    try {
        const scores = await visionClient.classify(
            path,
            PLACES.map((p) => p.prompt),
        );
        const best = [...scores].sort((a, b) => b.score - a.score)[0];
        const known = PLACES.find((p) => p.prompt === best?.label);
        return known && best && best.score >= PLACE_MIN_SCORE
            ? { place: known.place, score: best.score }
            : { place: null, score: null };
    } catch (error) {
        // A failed guess must not fail the sorting itself.
        logger.warn({ err: error }, 'place guess failed');
        return { place: null, score: null };
    }
}

/**
 * A folder named after a place ("Paris", "Beach") takes a picture the sorter recognised there, unless the subject
 * descent already filed it deeper than that.
 */
export function placeDecision(
    decision: Decision,
    place: string | null,
    placeScore: number | null,
    categories: Category[],
): Decision {
    if (!place || placeScore === null || decision.status === 'sorted') return decision;
    const haystack = place.toLowerCase();
    const match = categories.find(
        (c) => c.name.length > 2 && haystack.includes(c.name.toLowerCase()),
    );
    return match ? { status: 'sorted', category: match, confidence: placeScore } : decision;
}

export const classificationService = {
    /**
     * Classifies one file against its owner's live category tree and records the outcome. Failure
     * to reach the vision service leaves the file untouched, so the next run retries it.
     *
     * @returns The decision, or null when the file could not be processed this time.
     */
    async classify(file: FileRecord): Promise<Decision | null> {
        // A folder named after the file's type (DOCX, Documents, GPX) takes it before anything is looked at.
        const categories = await categoryRepository.listAll(file.userId);
        let mime = file.mime;
        if (mime === 'application/octet-stream') {
            // "media-5" with no extension and no type: the first bytes usually say what it is.
            mime =
                (await sniffMime(await blobStore.ensureLocal(file.blobSha256)).catch(() => null)) ??
                mime;
        }
        const byType = folderForFile({ name: file.name, mime }, categories);
        if (byType || !mime.startsWith('image/')) {
            const decision: Decision = byType
                ? { status: 'sorted', category: byType, confidence: 1 }
                : { status: 'unsorted', category: null, confidence: null };
            // Nothing to look at otherwise: mark it seen so it is not retried forever.
            await fileRepository.setClassification(file.id, {
                status: decision.status,
                categoryId: byType?.id ?? null,
                suggestedCategoryId: null,
                confidence: decision.confidence,
                nsfwScore: null,
                embedding: null,
            });
            return decision;
        }

        try {
            const path = await blobStore.ensureLocal(file.blobSha256);
            const [embedding, nsfw] = await Promise.all([
                visionClient.embed(path),
                visionClient.nsfw(path),
            ]);
            // Explicit pictures are not worth a landmark guess.
            const { place, score: placeScore } =
                nsfw >= 0.5 ? { place: null, score: null } : await guessPlace(path);
            const decision = placeDecision(
                await descend(
                    (parentId) => categoryRepository.listChildren(file.userId, parentId),
                    (labels) => visionClient.classify(path, labels),
                    config.sorting.autoFileThreshold,
                    nsfw,
                    config.sorting.reviewFloor,
                ),
                place,
                placeScore,
                await categoryRepository.listAll(file.userId),
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
                place,
                placeScore,
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
