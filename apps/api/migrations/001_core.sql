-- ===========================================================================
-- 001_core.sql — identity, access control, settings, platform tables
-- Dialect: PostgreSQL + SQLite (TEXT/INTEGER only, application generated ids)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  name        TEXT PRIMARY KEY,
  checksum    TEXT NOT NULL,
  applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0,
  permissions TEXT NOT NULL DEFAULT '[]',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,
  kind                 TEXT NOT NULL,             -- customer | staff | admin
  role_id              TEXT REFERENCES roles(id),
  mobile               TEXT,
  mobile_verified      INTEGER NOT NULL DEFAULT 0,
  email                TEXT,
  username             TEXT,
  password_hash        TEXT,
  full_name            TEXT NOT NULL DEFAULT '',
  national_id          TEXT,
  status               TEXT NOT NULL DEFAULT 'active', -- active | pending | suspended
  avatar_file_id       TEXT,
  mfa_secret           TEXT,
  mfa_enabled          INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at        TEXT,
  failed_attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until         TEXT,
  notes                TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_users_mobile   ON users (kind, mobile)   WHERE mobile IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username ON users (username)       WHERE username IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email    ON users (email)          WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_users_kind            ON users (kind, status);
CREATE INDEX IF NOT EXISTS ix_users_role            ON users (role_id);

CREATE TABLE IF NOT EXISTS customer_profiles (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  address      TEXT,
  postal_code  TEXT,
  birth_date   TEXT,
  job_title    TEXT,
  province     TEXT,
  city         TEXT,
  extra        TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_profiles (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  employee_code     TEXT,
  position          TEXT,
  specialties       TEXT NOT NULL DEFAULT '[]',   -- json array of category/service ids
  max_active_cases  INTEGER NOT NULL DEFAULT 20,
  accepts_new_cases INTEGER NOT NULL DEFAULT 1,
  hired_at          TEXT,
  notes             TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_staff_code ON staff_profiles (employee_code) WHERE employee_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  ip           TEXT,
  user_agent   TEXT,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT,
  last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions (user_id, revoked_at);

CREATE TABLE IF NOT EXISTS otp_codes (
  id          TEXT PRIMARY KEY,
  mobile      TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  purpose     TEXT NOT NULL DEFAULT 'login',
  attempts    INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at  TEXT NOT NULL,
  consumed_at TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_otp_mobile ON otp_codes (mobile, created_at);

CREATE TABLE IF NOT EXISTS login_events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  identifier TEXT,
  method     TEXT,
  success    INTEGER NOT NULL DEFAULT 0,
  reason     TEXT,
  ip         TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_login_events_id ON login_events (identifier, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT,
  actor_name  TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  before_data TEXT,
  after_data  TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_logs (created_at);
CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_logs (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS files (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL DEFAULT 0,
  storage_key TEXT NOT NULL,
  sha256      TEXT,
  is_public   INTEGER NOT NULL DEFAULT 0,
  purpose     TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_files_owner ON files (owner_id);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  group_name  TEXT NOT NULL,
  is_secret   INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT,
  kind       TEXT NOT NULL DEFAULT 'info',
  link       TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_notifications_user ON notifications (user_id, read_at);

CREATE TABLE IF NOT EXISTS sms_logs (
  id                  TEXT PRIMARY KEY,
  mobile              TEXT NOT NULL,
  purpose             TEXT,
  provider            TEXT NOT NULL,
  template_code       TEXT,
  body                TEXT,
  status              TEXT NOT NULL,             -- sent | failed | skipped
  provider_message_id TEXT,
  error               TEXT,
  created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sms_logs_created ON sms_logs (created_at);

CREATE TABLE IF NOT EXISTS backups (
  id         TEXT PRIMARY KEY,
  filename   TEXT NOT NULL,
  size       INTEGER NOT NULL DEFAULT 0,
  checksum   TEXT,
  location   TEXT,
  status     TEXT NOT NULL DEFAULT 'ok',
  note       TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_records (
  id          TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  label       TEXT,
  value       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_customer_records ON customer_records (customer_id, key);
