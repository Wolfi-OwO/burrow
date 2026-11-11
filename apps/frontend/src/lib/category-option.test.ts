import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { categoryOption } from './format.ts';

describe('categoryOption', () => {
    it('leaves a top-level folder as it is', () => {
        assert.equal(categoryOption(0, 'Private'), 'Private');
    });

    it('marks every deeper folder with a visible corner and indents it by depth', () => {
        assert.match(categoryOption(1, 'Furry'), /^ {3}└ Furry$/);
        assert.match(categoryOption(2, 'NSFW'), /^ {6}└ NSFW$/);
    });
});
