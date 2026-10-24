-- The default text-search parser reads "wolf.png" and "my_photo-1.jpg" as single file/host tokens, so a search
-- for "wolf" missed every file with an extension. Names are split on anything that is not a letter or digit
-- before they are indexed.
DROP INDEX files_search_gin_idx;
ALTER TABLE files DROP COLUMN search;
ALTER TABLE files ADD COLUMN search tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', regexp_replace(name, '[^[:alnum:]]+', ' ', 'g'))) STORED;
CREATE INDEX files_search_gin_idx ON files USING gin (search);
