-- What the local disk holds of the blobs when an S3-compatible store is the store of record (S3_* configured and
-- BLOB_CACHE_GB set). The local directory is then a cache: this table says which blobs are in it, how big they are
-- and when they were last read, so the least recently used ones can be removed when the cache is full or the disk is.
-- Without an S3 store nothing writes here.
CREATE TABLE blob_cache (
    sha256      char(64) PRIMARY KEY REFERENCES blobs (sha256) ON DELETE CASCADE,
    size        bigint NOT NULL,
    last_access timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX blob_cache_last_access_idx ON blob_cache (last_access);
