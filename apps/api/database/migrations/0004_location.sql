-- Where a picture was taken. `latitude`/`longitude` come from the photo's own EXIF GPS tag when it has one; `place`
-- is the sorter's guess at a landmark or kind of scene from the picture itself, `place_score` how sure it was.
ALTER TABLE files
    ADD COLUMN latitude    double precision,
    ADD COLUMN longitude   double precision,
    ADD COLUMN place       text,
    ADD COLUMN place_score real,
    ADD COLUMN taken_at    timestamptz;

-- Search matches the place guess as well as the name, so "Paris" finds what the sorter recognised there.
DROP INDEX files_search_gin_idx;
ALTER TABLE files DROP COLUMN search;
ALTER TABLE files ADD COLUMN search tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', regexp_replace(name || ' ' || COALESCE(place, ''), '[^[:alnum:]]+', ' ', 'g'))) STORED;
CREATE INDEX files_search_gin_idx ON files USING gin (search);
