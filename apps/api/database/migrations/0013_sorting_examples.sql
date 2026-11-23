-- What the person decided by hand. A file filed, moved or accepted from review by its owner is an example of what
-- belongs in that folder; the sorter weighs new pictures against these as well as against the folder names, so a
-- correction is remembered. Kept apart from files.category_id on purpose: "Unsort everything" and "Re-sort this
-- folder" clear where files sit, and must not make the sorter forget what it was taught.
CREATE TABLE sorting_examples (
    file_id     uuid PRIMARY KEY REFERENCES files (id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    category_id bigint NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sorting_examples_user_idx ON sorting_examples (user_id);
