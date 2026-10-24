-- burrow initial schema. ltree holds the category tree (ADR-0003: the label is the
-- surrogate id, never the user's name), pgvector the CLIP embedding (ADR-0004).
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username      text NOT NULL,
    -- NULL for an account that only ever logged in through an OIDC provider.
    password_hash text,
    display_name  text NOT NULL,
    bio           text NOT NULL DEFAULT '',
    avatar_sha256 char(64),
    role          text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_lower_idx ON users (lower(username));

CREATE TABLE user_identities (
    id               bigserial PRIMARY KEY,
    user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    provider         text NOT NULL CHECK (provider IN ('github', 'microsoft', 'google')),
    provider_user_id text NOT NULL,
    email            text,
    email_verified   boolean NOT NULL DEFAULT false,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_user_id),
    UNIQUE (user_id, provider)
);

-- One row per login. The access token carries the row id, so revoking the row
-- (logout) ends the session at once instead of when the JWT happens to expire.
CREATE TABLE sessions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    refresh_hash char(64) NOT NULL UNIQUE,
    user_agent   text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE blobs (
    sha256     char(64) PRIMARY KEY,
    size       bigint NOT NULL,
    mime       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
    id             bigserial PRIMARY KEY,
    user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    parent_id      bigint REFERENCES categories (id) ON DELETE RESTRICT,
    name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    path           ltree NOT NULL,
    -- Required by the NSFW gate (FR-037): a category that may ever sit behind a
    -- preview link must never receive an auto-filed NSFW file.
    public_preview boolean NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX categories_path_gist_idx ON categories USING gist (path);
CREATE INDEX categories_parent_idx ON categories (parent_id);
-- Sibling names are unique per owner, case-insensitively; parent 0 stands for the root.
CREATE UNIQUE INDEX categories_sibling_name_idx
    ON categories (user_id, COALESCE(parent_id, 0), lower(name));

CREATE TABLE files (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    blob_sha256           char(64) NOT NULL REFERENCES blobs (sha256),
    name                  text NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
    mime                  text NOT NULL,
    size                  bigint NOT NULL,
    category_id           bigint REFERENCES categories (id) ON DELETE SET NULL,
    status                text NOT NULL DEFAULT 'unsorted' CHECK (status IN ('unsorted', 'sorted', 'review')),
    suggested_category_id bigint REFERENCES categories (id) ON DELETE SET NULL,
    confidence            real,
    nsfw_score            real,
    -- Set once a scheduler run has looked at the file; never cleared, so a run
    -- cannot reprocess it and a resolved review item cannot come back (FR-041, FR-045).
    classified_at         timestamptz,
    embedding             vector(512),
    search                tsvector GENERATED ALWAYS AS (to_tsvector('simple', name)) STORED,
    created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_user_status_idx ON files (user_id, status);
CREATE INDEX files_category_idx ON files (category_id);
CREATE INDEX files_search_gin_idx ON files USING gin (search);
CREATE INDEX files_backlog_idx ON files (user_id) WHERE classified_at IS NULL;

CREATE TABLE scheduler_state (
    id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    last_run_at timestamptz
);
INSERT INTO scheduler_state (id) VALUES (1);
