-- Migration A: Add new columns as nullable (safe to apply while app is running)
ALTER TABLE users RENAME COLUMN role TO job_title;
ALTER TABLE users ADD COLUMN role TEXT;
ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active';
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN created_by TEXT REFERENCES users(id);
ALTER TABLE users ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMPTZ;

-- Audit log table
CREATE TABLE user_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_user_id TEXT NOT NULL REFERENCES users(id),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL CHECK (action IN ('granted', 'role_changed', 'revoked', 'restored')),
  from_role TEXT,
  to_role TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
