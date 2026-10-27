import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { tidyFileName } from '../../src/lib/file-name.ts';

describe('tidying file names', () => {
    it('decodes percent escapes', () => {
        assert.equal(tidyFileName('Hauptbuch%20(Nr11).pptx'), 'Hauptbuch (Nr11).pptx');
        assert.equal(tidyFileName('Gr%C3%BC%C3%9Fe.txt'), 'Grüße.txt');
    });
    it('leaves a lone percent sign and malformed escapes alone', () => {
        assert.equal(tidyFileName('100% done.txt'), '100% done.txt');
        assert.equal(tidyFileName('a%E0%A4%A.txt'), 'a%E0%A4%A.txt');
    });
    it('collapses runs of spaces', () => {
        assert.equal(tidyFileName('a   b .txt'), 'a b .txt');
    });
});
