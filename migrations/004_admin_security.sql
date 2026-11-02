-- 004_admin_security.sql : admin sessions and login protection. Additive only.

ALTER TABLE admins ADD COLUMN role            text NOT NULL DEFAULT 'owner';
ALTER TABLE admins ADD COLUMN is_active       boolean NOT NULL DEFAULT true;
ALTER TABLE admins ADD COLUMN failed_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN locked_until    timestamptz;

-- Only a keyed hash of each session token is stored, never the token itself.
CREATE TABLE admin_sessions (
  id           bigserial PRIMARY KEY,
  admin_id     integer NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ip           text NOT NULL DEFAULT '',
  user_agent   text NOT NULL DEFAULT ''
);
CREATE INDEX admin_sessions_admin_idx ON admin_sessions (admin_id);
CREATE INDEX admin_sessions_expires_idx ON admin_sessions (expires_at);
