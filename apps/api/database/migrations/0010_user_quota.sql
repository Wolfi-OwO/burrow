-- A per-account storage limit, so one person cannot fill the disk for everyone. NULL means the server's default
-- (USER_QUOTA_GB); 0 means no limit (for the operator's own account); any other value is the limit in bytes.
ALTER TABLE users ADD COLUMN quota_bytes bigint CHECK (quota_bytes IS NULL OR quota_bytes >= 0);
