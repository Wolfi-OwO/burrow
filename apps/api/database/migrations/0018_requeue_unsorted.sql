-- The sorter now looks through folders that only hold other folders (a top-level "Private" with everything inside),
-- which it never did before: every picture it had looked at under the old rule stayed unsorted for a reason that no
-- longer applies. "Sort now" would skip them (nothing in the folders changed since), so they go back in the queue once.
UPDATE files SET classified_at = NULL
WHERE status = 'unsorted' AND category_id IS NULL AND classified_at IS NOT NULL;
