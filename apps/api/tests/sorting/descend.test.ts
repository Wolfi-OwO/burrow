import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Category } from '../../src/models/category.model.ts';
import { descend } from '../../src/services/classification-service.ts';
import { intervalMs, isDue, runsPerDay } from '../../src/services/scheduler-service.ts';

const cat = (id: number, name: string, parentId: number | null): Category => ({
    id,
    userId: 'u',
    parentId,
    name,
    path: String(id),
    publicPreview: false,
});
const TREE = [
    cat(1, 'Furry', null),
    cat(2, 'Nature', null),
    cat(3, 'SFW', 1),
    cat(4, 'NSFW', 1),
    cat(5, 'WOLF', 3),
];
const children = (parentId: number | null): Promise<Category[]> =>
    Promise.resolve(TREE.filter((c) => c.parentId === parentId));
/** A scorer that gives each named label the stated probability and the rest nothing. */
const scorer = (known: Record<string, number>) => (labels: string[]) =>
    Promise.resolve(labels.map((label) => ({ label, score: known[label] ?? 0 })));

describe('rating levels (SFW / NSFW) follow the NSFW score, not the labels', () => {
    it('files an explicit picture under NSFW even when the labels prefer SFW', async () => {
        const d = await descend(children, scorer({ Furry: 0.9, SFW: 0.95, NSFW: 0.05 }), 0.6, 0.93);
        assert.equal(d.category?.name, 'NSFW');
        assert.equal(d.status, 'sorted');
    });

    it('files a clean picture under SFW and still descends below it', async () => {
        const d = await descend(children, scorer({ Furry: 0.9, WOLF: 0.8 }), 0.6, 0.03);
        assert.equal(d.category?.name, 'WOLF');
    });

    it('sends the grey zone to review instead of guessing a side', async () => {
        const d = await descend(children, scorer({ Furry: 0.9 }), 0.6, 0.5);
        assert.equal(d.status, 'sorted');
        assert.equal(
            d.category?.name,
            'Furry',
            'stays at the subject level; the rating is not decided',
        );
    });

    it('does not mis-file an explicit picture when there is only a SFW category', async () => {
        const only = [cat(1, 'Furry', null), cat(3, 'SFW', 1)];
        const d = await descend(
            (id) => Promise.resolve(only.filter((c) => c.parentId === id)),
            scorer({ Furry: 0.9 }),
            0.6,
            0.97,
        );
        assert.equal(d.category?.name, 'Furry');
    });
});

describe('descent (FR-038, FR-039)', () => {
    it('descends to the most specific leaf that clears the threshold', async () => {
        const d = await descend(children, scorer({ Furry: 0.9, SFW: 0.8, WOLF: 0.7 }), 0.6);
        assert.equal(d.status, 'sorted');
        assert.equal(d.category?.name, 'WOLF');
        assert.equal(d.confidence, 0.7);
    });

    it('stops at the current level when no child clears the threshold, instead of failing', async () => {
        const d = await descend(
            children,
            scorer({ Furry: 0.9, SFW: 0.3, NSFW: 0.2, 'something else': 0.5 }),
            0.6,
        );
        assert.equal(d.status, 'sorted');
        assert.equal(d.category?.name, 'Furry');
    });

    it('sends a file to review with its best guess when no top-level category clears the threshold (FR-043)', async () => {
        const d = await descend(children, scorer({ Furry: 0.4, Nature: 0.35 }), 0.6);
        assert.equal(d.status, 'review');
        assert.equal(d.category?.name, 'Furry');
        assert.equal(d.confidence, 0.4);
    });

    it('leaves the file unsorted when the user has no categories at all', async () => {
        const d = await descend(() => Promise.resolve([]), scorer({}), 0.6);
        assert.deepEqual(d, { status: 'unsorted', category: null, confidence: null });
    });

    it('offers "something else" as a competitor at every level', async () => {
        const seen: string[][] = [];
        await descend(
            children,
            (labels) => {
                seen.push(labels);
                return Promise.resolve(labels.map((label) => ({ label, score: 0 })));
            },
            0.6,
        );
        assert.ok(seen.every((labels) => labels.includes('something else')));
    });
});

describe('scheduler timing (FR-040)', () => {
    it('runs 10 times a day when idle and 30 a day under a heavy backlog, scaling between', () => {
        assert.equal(runsPerDay(1), 10);
        assert.equal(runsPerDay(250), 20);
        assert.equal(runsPerDay(500), 30);
        assert.equal(runsPerDay(100_000), 30);
        assert.ok(intervalMs(500) < intervalMs(1));
    });

    it('is due when it never ran or the interval has passed, and never due with an empty backlog', () => {
        const now = new Date('2026-10-24T12:00:00Z');
        assert.equal(isDue(null, 5, now), true);
        assert.equal(isDue(new Date(now.getTime() - 60_000), 5, now), false);
        assert.equal(isDue(new Date(now.getTime() - intervalMs(5) - 1), 5, now), true);
        assert.equal(isDue(null, 0, now), false);
    });
});

describe('a folder is scored under every phrasing, summed', () => {
    it('files drawn artwork the bare folder name would lose to a competitor label', async () => {
        const d = await descend(
            children,
            scorer({
                Furry: 0.2,
                'an illustration of Furry': 0.15,
                'a fursona character with fur and a tail': 0.35,
                'a screenshot': 0.25,
            }),
            0.6,
            0.03,
        );
        assert.equal(d.category?.name, 'SFW');
        assert.equal(d.status, 'sorted');
    });
});
