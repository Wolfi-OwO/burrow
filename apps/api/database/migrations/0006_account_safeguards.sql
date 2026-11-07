-- The NSFW classifier looks at people's pictures for nudity, which can be special-category data (Art 9 DSGVO), so it only
-- runs for accounts that switched it on. New accounts start with it off.
ALTER TABLE users ADD COLUMN nsfw_opt_in boolean NOT NULL DEFAULT false;

-- Accounts that existed before this switch keep the behaviour they already had.
UPDATE users SET nsfw_opt_in = true;
