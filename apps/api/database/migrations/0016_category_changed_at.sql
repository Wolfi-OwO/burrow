-- "Sort now" looks again at the files the sorter left unsorted, but only when something that could change its
-- mind has happened since: a folder made, renamed or moved. Without this stamp every press looked at all of them again.
ALTER TABLE categories ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE FUNCTION categories_touch() RETURNS trigger AS $$
BEGIN
    IF NEW.name IS DISTINCT FROM OLD.name OR NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
        NEW.updated_at = now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER categories_touch BEFORE UPDATE ON categories
    FOR EACH ROW EXECUTE FUNCTION categories_touch();
