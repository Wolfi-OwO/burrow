-- Share links: one row per link, pointing at a file or at a whole category (its subtree). `access` decides who may
-- open it: anyone holding the link ('link'), or only the signed-in accounts listed in share_users ('users').
-- A NULL expires_at is a permanent link; revoking sets revoked_at so the link dies at once but stays in the list.
CREATE TABLE shares (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token       text NOT NULL UNIQUE,
    file_id     uuid REFERENCES files (id) ON DELETE CASCADE,
    category_id bigint REFERENCES categories (id) ON DELETE CASCADE,
    access      text NOT NULL CHECK (access IN ('link', 'users')),
    expires_at  timestamptz,
    revoked_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CHECK ((file_id IS NULL) <> (category_id IS NULL))
);
CREATE INDEX shares_owner_idx ON shares (owner_id, created_at DESC);

CREATE TABLE share_users (
    share_id uuid NOT NULL REFERENCES shares (id) ON DELETE CASCADE,
    user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    PRIMARY KEY (share_id, user_id)
);
CREATE INDEX share_users_user_idx ON share_users (user_id);
