-- 047: the email channel — SMTP send ledger, one-time email tokens, verification
-- state and per-user email alarm preferences.
--
-- Privacy rules carried over from sms_logs: the body is NOT stored unless the
-- operator explicitly switches email.log_body on; tokens are stored hashed,
-- never in clear, and are single-use with an expiry.

ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;

-- One row per send attempt; idempotency_key makes a retried event send once.
CREATE TABLE IF NOT EXISTS email_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  to_email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  subject TEXT,
  body TEXT,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,              -- pending | sent | failed | skipped
  provider_message_id TEXT,
  error TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
-- Plain UNIQUE (like sms_logs): NULLs stay distinct on both engines, and the
-- ON CONFLICT(idempotency_key) target matches without a partial-index WHERE.
CREATE UNIQUE INDEX IF NOT EXISTS ux_email_logs_idem ON email_logs (idempotency_key);
CREATE INDEX IF NOT EXISTS ix_email_logs_created ON email_logs (created_at);
CREATE INDEX IF NOT EXISTS ix_email_logs_user ON email_logs (user_id, created_at);

-- One-time tokens for password reset and email verification. The clear token
-- exists only inside the email that was sent; the server keeps its SHA-256.
CREATE TABLE IF NOT EXISTS email_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,             -- reset_password | verify_email
  token_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_email_tokens_hash ON email_tokens (token_hash);
CREATE INDEX IF NOT EXISTS ix_email_tokens_user ON email_tokens (user_id, purpose, created_at);

-- Per-user email alarm preferences («کدام هشدارها به ایمیل من برسد»).
-- Absent row = defaults: everything on, subject to the system-level toggles.
CREATE TABLE IF NOT EXISTS user_notification_prefs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_enabled INTEGER NOT NULL DEFAULT 1,
  email_tickets INTEGER NOT NULL DEFAULT 1,
  email_cases INTEGER NOT NULL DEFAULT 1,
  email_payments INTEGER NOT NULL DEFAULT 1,
  email_security INTEGER NOT NULL DEFAULT 1,
  email_announcements INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
