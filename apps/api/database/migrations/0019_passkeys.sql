-- Passkeys (WebAuthn) as a second way to sign in, next to the password, and the scheme a password was stored under.
--
-- 'legacy': the hash is of the password as typed. 'v1': the hash is of the proof the browser derives from the password
-- (PBKDF2, see apps/frontend/src/lib/password-proof.ts), so the typed password never reaches the server. A legacy
-- account moves to v1 on its next successful sign-in.
ALTER TABLE users ADD COLUMN password_scheme text NOT NULL DEFAULT 'legacy'
    CHECK (password_scheme IN ('legacy', 'v1'));

CREATE TABLE passkeys (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id text NOT NULL UNIQUE,
    public_key    bytea NOT NULL,
    counter       bigint NOT NULL DEFAULT 0,
    transports    text[] NOT NULL DEFAULT '{}',
    device_type   text NOT NULL DEFAULT 'singleDevice',
    backed_up     boolean NOT NULL DEFAULT false,
    name          text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_used_at  timestamptz
);
CREATE INDEX passkeys_user_idx ON passkeys (user_id);

-- One row per ceremony in flight. In the database rather than in memory because a deploy briefly runs two containers.
CREATE TABLE webauthn_challenges (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge  text NOT NULL,
    user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
    purpose    text NOT NULL CHECK (purpose IN ('register', 'login')),
    expires_at timestamptz NOT NULL
);
