import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { categoryRows, placeList, typeAhead } from './category-select.ts';

const tree = [
    { id: 1, name: 'Private', depth: 0 },
    { id: 2, name: 'Furry', depth: 1 },
    { id: 3, name: 'NSFW', depth: 2 },
    { id: 4, name: 'SFW', depth: 2 },
    { id: 5, name: 'Nature', depth: 1 },
    { id: 6, name: 'Public', depth: 0 },
];

describe('categoryRows', () => {
    it('puts the empty choice first and gives every folder its depth and full path', () => {
        const rows = categoryRows(tree, 'Unsorted');
        assert.deepEqual(rows[0], { value: '', label: 'Unsorted', depth: 0, path: 'Unsorted' });
        assert.deepEqual(
            rows.slice(1).map((r) => [r.value, r.depth, r.path]),
            [
                ['1', 0, 'Private'],
                ['2', 1, 'Private / Furry'],
                ['3', 2, 'Private / Furry / NSFW'],
                ['4', 2, 'Private / Furry / SFW'],
                ['5', 1, 'Private / Nature'],
                ['6', 0, 'Public'],
            ],
        );
    });
});

describe('placeList', () => {
    it('opens below a button with room, as wide as at least a long name needs', () => {
        const p = placeList({ left: 100, top: 100, bottom: 138, width: 170 }, 1400, 900);
        assert.equal(p.above, false);
        assert.equal(p.top, 142);
        assert.equal(p.width, 280);
        assert.equal(p.maxHeight, 360);
    });

    it('never runs off the right edge, however far right the button sits', () => {
        const p = placeList({ left: 1300, top: 100, bottom: 138, width: 170 }, 1400, 900);
        assert.ok(p.left + p.width <= 1400 - 8);
        assert.ok(p.left >= 8);
    });

    it('fits a narrow screen', () => {
        const p = placeList({ left: 20, top: 100, bottom: 138, width: 400 }, 320, 700);
        assert.equal(p.width, 304);
        assert.equal(p.left, 8);
    });

    it('opens above the button near the bottom of the screen, and stays inside it', () => {
        const p = placeList({ left: 100, top: 700, bottom: 738, width: 170 }, 1400, 800);
        assert.equal(p.above, true);
        assert.ok(p.top <= 700);
        assert.ok(p.maxHeight <= 700 - 8);
    });
});

describe('typeAhead', () => {
    const rows = categoryRows(tree, 'Another category...');
    it('finds the next line starting with the typed letters and wraps around', () => {
        assert.equal(typeAhead(rows, 'nat', 0), 5);
        assert.equal(typeAhead(rows, 'p', 0), 1);
        assert.equal(typeAhead(rows, 'p', 2), 6);
        assert.equal(typeAhead(rows, 'p', 7), 1);
        assert.equal(typeAhead(rows, 'zzz', 0), -1);
    });
});
