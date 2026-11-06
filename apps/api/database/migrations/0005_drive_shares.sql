-- A share can now also cover the owner's whole drive: every file, whatever its folder. The old rule (a file or a
-- category, never both) becomes "exactly one of a file, a category or the whole drive".
ALTER TABLE shares ADD COLUMN whole_drive boolean NOT NULL DEFAULT false;
ALTER TABLE shares DROP CONSTRAINT shares_check;
ALTER TABLE shares ADD CONSTRAINT shares_one_target
    CHECK ((file_id IS NOT NULL)::int + (category_id IS NOT NULL)::int + whole_drive::int = 1);
