-- What the person turned down. A review suggestion that was left alone or moved elsewhere says "not this folder" for
-- pictures like it, so the same wrong guess is not offered again. A file can reject several folders.
CREATE TABLE sorting_rejections (
    file_id     uuid NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    category_id bigint NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (file_id, category_id)
);
CREATE INDEX sorting_rejections_user_idx ON sorting_rejections (user_id);
