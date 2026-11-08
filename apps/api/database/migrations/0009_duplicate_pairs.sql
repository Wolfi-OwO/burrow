-- "Same picture, other size" is found in the background, a few files at a time, instead of when the page is opened:
-- comparing every picture with every other one takes long on a big drive. What was found is stored here.

ALTER TABLE files ADD COLUMN dup_checked_at timestamptz;

-- The files still waiting for their comparison: tiny, because most files are checked.
CREATE INDEX files_dup_pending_idx ON files (created_at)
    WHERE embedding IS NOT NULL AND dup_checked_at IS NULL;

-- Finding a picture's nearest neighbours without it reads every other picture: 5,400 pictures took 6 s per 200
-- compared, 11,000 more than 9 minutes; with the index the same work takes about 20 s in total. Measured with 100
-- planted copies among 11,100 pictures of two accounts: all 100 found.
CREATE INDEX files_embedding_hnsw ON files USING hnsw (embedding vector_cosine_ops);

CREATE TABLE duplicate_pairs (
    a_id     uuid NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    b_id     uuid NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- Cosine distance between the two pictures' embeddings; the page filters on the current threshold.
    distance real NOT NULL,
    found_at timestamptz NOT NULL DEFAULT now(),
    -- One row per pair, whichever side found it.
    PRIMARY KEY (a_id, b_id),
    CHECK (a_id < b_id)
);
CREATE INDEX duplicate_pairs_user_idx ON duplicate_pairs (user_id);
CREATE INDEX duplicate_pairs_b_idx ON duplicate_pairs (b_id);
