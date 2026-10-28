-- Configurable, event-scoped SMS pattern registry and idempotent notification/send records.
CREATE TABLE IF NOT EXISTS sms_templates (
  event_code TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  recipient_type TEXT NOT NULL,
  body_id TEXT NOT NULL DEFAULT '',
  pattern_text TEXT NOT NULL DEFAULT '',
  parameter_names TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 0,
  validation_status TEXT NOT NULL DEFAULT 'incomplete',
  validation_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

ALTER TABLE notifications ADD COLUMN dedupe_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_notifications_dedupe ON notifications (dedupe_key);

ALTER TABLE sms_logs ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_sms_logs_idempotency ON sms_logs (idempotency_key);
