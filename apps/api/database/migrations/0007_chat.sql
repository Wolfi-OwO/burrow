-- The assistant chat: what was said, and what the user taught the sorter about a folder.

CREATE TABLE chat_messages (
    id         bigserial PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role       text NOT NULL CHECK (role IN ('user', 'assistant')),
    content    text NOT NULL,
    -- What the assistant did in answer (folders created, phrases learned), shown as cards under the message.
    actions    jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_user_idx ON chat_messages (user_id, id);

-- A phrase the sorter scores a folder under in addition to its name ("an orange tabby cat" for Cats).
-- It is the one thing the chat teaches the sorter, and it goes away with the folder.
CREATE TABLE category_hints (
    id          bigserial PRIMARY KEY,
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    category_id bigint NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
    phrase      text NOT NULL CHECK (length(phrase) BETWEEN 3 AND 120),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (category_id, phrase)
);
CREATE INDEX category_hints_user_idx ON category_hints (user_id);
