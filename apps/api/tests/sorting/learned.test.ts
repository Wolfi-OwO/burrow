import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    blend,
    learnedShare,
    rejectionFactors,
    weightOf,
    type Learned,
} from '../../src/lib/learned-sorting.ts';
import type { Category } from '../../src/models/category.model.ts';
import { descend } from '../../src/services/classification-service.ts';

const cat = (id: number, name: string, parentId: number | null): Category => ({
    id,
    userId: 'u',
    parentId,
    name,
    path: String(id),
    publicPreview: false,
});
// Two top-level folders and one folder inside Furry, as a person might have them.
const TREE = [cat(1, 'Furry', null), cat(2, 'Matura feier', null), cat(3, 'Wolves', 1)];
const parentOf = new Map(TREE.map((c) => [c.id, c.parentId]));
const children = (parentId: number | null): Promise<Category[]> =>
    Promise.resolve(TREE.filter((c) => c.parentId === parentId));
const scorer = (known: Record<string, number>) => (labels: string[]) =>
    Promise.resolve(labels.map((label) => ({ label, score: known[label] ?? 0 })));
const examples = (...pairs: [number, number][]): Learned => ({
    neighbours: pairs.map(([categoryId, similarity]) => ({ categoryId, similarity })),
    parentOf,
});

describe('weighing the examples', () => {
    it('counts nothing below the similarity floor and everything for the same picture', () => {
        assert.equal(weightOf(0.6), 0);
        assert.equal(weightOf(0.75), 0);
        assert.equal(weightOf(1), 1);
        assert.ok(weightOf(0.9) > weightOf(0.8));
    });

    it('gives a folder the examples filed anywhere inside it', () => {
        const { share } = learnedShare(examples([3, 0.95]), [TREE[0]!, TREE[1]!]);
        assert.equal(share.get(1), 1, 'an example in Furry > Wolves votes for Furry');
        assert.equal(share.get(2), undefined);
    });

    it('ignores examples that sit outside every folder being decided', () => {
        const { share, strength } = learnedShare(examples([2, 0.95]), [TREE[2]!]);
        assert.equal(share.size, 0);
        assert.equal(strength, 0);
    });

    it('is full strength with a few close examples and weak with one distant one', () => {
        const many = learnedShare(examples([1, 0.95], [1, 0.95], [1, 0.95]), [TREE[0]!]);
        const one = learnedShare(examples([1, 0.8]), [TREE[0]!]);
        assert.equal(many.strength, 1);
        assert.ok(one.strength < 0.2);
    });

    it('leaves the zero-shot score unchanged when there is no evidence', () => {
        assert.equal(blend(0.42, 0, 0), 0.42);
    });
});

describe('descend with learned examples', () => {
    // The picture model reads "Matura feier" as a graduation party and is wrong about this picture.
    const wrongGuess = scorer({ 'Matura feier': 0.75, Furry: 0.1 });

    it('files by the zero-shot labels when nothing has been taught', async () => {
        const d = await descend(children, wrongGuess, 0.6);
        assert.equal(d.category?.name, 'Matura feier');
    });

    it('follows three pictures the person already filed under Furry, against the labels', async () => {
        const d = await descend(
            children,
            wrongGuess,
            0.6,
            null,
            0.3,
            new Map(),
            examples([1, 0.93], [1, 0.9], [1, 0.9]),
        );
        assert.equal(d.status, 'sorted');
        assert.equal(d.category?.name, 'Furry');
    });

    it('does not let a single example overrule a clear zero-shot answer', async () => {
        const d = await descend(
            children,
            scorer({ 'Matura feier': 0.9, Furry: 0.05 }),
            0.6,
            null,
            0.3,
            new Map(),
            examples([1, 0.85]),
        );
        assert.equal(d.category?.name, 'Matura feier');
    });

    it('ignores examples that look nothing like the picture', async () => {
        const d = await descend(
            children,
            wrongGuess,
            0.6,
            null,
            0.3,
            new Map(),
            examples([1, 0.6], [1, 0.62], [1, 0.7]),
        );
        assert.equal(d.category?.name, 'Matura feier');
    });

    it('can file into a folder the labels know nothing about', async () => {
        const d = await descend(
            children,
            scorer({}),
            0.6,
            null,
            0.3,
            new Map(),
            examples([1, 0.96], [1, 0.94], [1, 0.92]),
        );
        assert.equal(d.category?.name, 'Furry');
    });
});

describe('turning a folder down', () => {
    const turnedDown = (...pairs: [number, number][]): Learned => ({
        neighbours: [],
        rejected: pairs.map(([categoryId, similarity]) => ({ categoryId, similarity })),
        parentOf,
    });

    it('leaves a folder alone when nothing close was turned down for it', () => {
        assert.equal(rejectionFactors(turnedDown([2, 0.6]), [TREE[0]!, TREE[1]!]).size, 0);
        assert.equal(rejectionFactors(turnedDown(), [TREE[0]!, TREE[1]!]).size, 0);
    });

    it('cuts a folder by most of its score after a few close refusals, never to nothing', () => {
        const few = rejectionFactors(turnedDown([2, 0.95], [2, 0.95], [2, 0.95]), [TREE[1]!]);
        assert.ok((few.get(2) ?? 1) < 0.2);
        assert.ok((few.get(2) ?? 0) > 0);
        const one = rejectionFactors(turnedDown([2, 0.95]), [TREE[1]!]);
        assert.ok((one.get(2) ?? 0) > (few.get(2) ?? 1));
    });

    it('stops suggesting a folder for pictures like the ones it was turned down for', async () => {
        const learned = turnedDown([2, 0.95], [2, 0.93], [2, 0.92]);
        const d = await descend(
            children,
            scorer({ 'Matura feier': 0.7 }),
            0.6,
            null,
            0.3,
            new Map(),
            learned,
        );
        assert.notEqual(d.category?.name, 'Matura feier');
        assert.equal(d.status, 'unsorted');
    });

    it('does not touch the other folders', async () => {
        const learned = turnedDown([2, 0.95], [2, 0.93], [2, 0.92]);
        const d = await descend(
            children,
            scorer({ 'Matura feier': 0.7, Furry: 0.8 }),
            0.6,
            null,
            0.3,
            new Map(),
            learned,
        );
        assert.equal(d.category?.name, 'Furry');
    });
});
