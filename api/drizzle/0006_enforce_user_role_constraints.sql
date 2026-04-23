-- Migration C: Enforce NOT NULL + CHECK constraints now that all rows are backfilled.
ALTER TABLE users ALTER COLUMN role SET NOT NULL;
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'modifier';
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'modifier', 'viewer'));

ALTER TABLE users ALTER COLUMN status SET NOT NULL;
ALTER TABLE users ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'revoked'));

ALTER TABLE users ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE users ALTER COLUMN created_at SET DEFAULT now();
