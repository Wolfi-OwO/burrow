import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { folderForFile } from '../../src/lib/type-folders.ts';
import type { Category } from '../../src/models/category.model.ts';

const cat = (id: number, name: string, path: string): Category => ({
    id,
    userId: 'u',
    parentId: null,
    name,
    path,
    publicPreview: false,
});
const tree = [
    cat(1, 'Documents', '1'),
    cat(2, 'DOCX', '1.2'),
    cat(3, 'GPX', '1.3'),
    cat(4, 'Code', '4'),
    cat(5, 'png files', '5'),
];

describe('filing by file type', () => {
    it('prefers a folder named after the extension over one named after the kind', () => {
        assert.equal(folderForFile({ name: 'a.DOCX', mime: 'application/zip' }, tree)?.id, 2);
        assert.equal(folderForFile({ name: 'ride.gpx', mime: 'application/gpx+xml' }, tree)?.id, 3);
    });
    it('falls back to the kind folder', () => {
        assert.equal(folderForFile({ name: 'a.pdf', mime: 'application/pdf' }, tree)?.id, 1);
        assert.equal(folderForFile({ name: 'a.py', mime: 'text/x-python' }, tree)?.id, 4);
    });
    it('leaves pictures to the picture model unless the folder names their extension', () => {
        assert.equal(folderForFile({ name: 'a.webp', mime: 'image/webp' }, tree), null);
        assert.equal(folderForFile({ name: 'a.png', mime: 'image/png' }, tree)?.id, 5);
    });
    it('finds nothing for a type without a folder', () => {
        assert.equal(
            folderForFile({ name: 'x.bin', mime: 'application/octet-stream' }, tree),
            null,
        );
    });
});
