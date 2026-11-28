-- Two files can hold the same content without sharing a single byte: a text saved with other line endings, a document
-- saved again (the zip inside only has other timestamps). The content key is a hash of what the file says, so those
-- count as exact copies. NULL means the bytes are the only identity there is (pictures, PDFs, video).
ALTER TABLE blobs ADD COLUMN content_key text;
ALTER TABLE blobs ADD COLUMN content_key_done boolean NOT NULL DEFAULT false;
CREATE INDEX blobs_content_key_idx ON blobs (content_key) WHERE content_key IS NOT NULL;
