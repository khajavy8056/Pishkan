-- Preserve individual rejection notices while consolidating approvals per case.
ALTER TABLE notifications ADD COLUMN event_type TEXT;
ALTER TABLE notifications ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS notification_aggregation_events (
  event_id TEXT PRIMARY KEY,
  notification_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
