-- "Remove all duplicates" runs in the background and is written down, like "Sort now": the page shows one progress bar
-- however often it is closed and opened again, and a server that stops in the middle (a deploy, a crash) picks the same
-- run up again. One row per account; a new run replaces the last one.
CREATE TABLE duplicate_clean_runs (
    user_id     uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    mode        text NOT NULL CHECK (mode IN ('exact', 'similar')),
    total       integer NOT NULL,
    done        integer NOT NULL DEFAULT 0,
    removed     integer NOT NULL DEFAULT 0,
    active      boolean NOT NULL DEFAULT true,
    started_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);
