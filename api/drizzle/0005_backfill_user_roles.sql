-- Migration B: Backfill — all existing users become 'modifier' by default.
-- ADMIN_USERS env var reconciliation at boot time will promote the configured admins.
UPDATE users SET role = 'modifier' WHERE role IS NULL;
UPDATE users SET status = 'active' WHERE status IS NULL;
UPDATE users SET created_at = now() WHERE created_at IS NULL;
