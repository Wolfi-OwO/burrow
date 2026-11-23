-- Why the sorter left a file in Unsorted, so "2,000 files were looked at and none were filed" can be explained
-- instead of guessed at. Only set while the file is unsorted after a look; null otherwise.
ALTER TABLE files ADD COLUMN unsorted_reason text
    CHECK (unsorted_reason IN ('weak', 'rating', 'no-folders', 'not-a-picture'));
