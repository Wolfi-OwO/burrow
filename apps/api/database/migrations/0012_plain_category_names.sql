-- The assistant once copied the "A > B" paths it was shown into folder names. A folder's place is its parent, never
-- its name, so keep only the last part. A row whose plain name is already taken by a sibling is left alone.
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT id, btrim(regexp_replace(name, '^.*>', '')) AS leaf
        FROM categories
        WHERE name LIKE '%>%'
    LOOP
        CONTINUE WHEN r.leaf = '';
        BEGIN
            UPDATE categories SET name = r.leaf WHERE id = r.id;
        EXCEPTION WHEN unique_violation THEN
            NULL;
        END;
    END LOOP;
END $$;
