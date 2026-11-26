-- 045: Takh Pishkhan Guard — security events, temporary IP blocks, scans,
-- file-integrity baseline, quarantine and internal state. Additive only.

CREATE TABLE IF NOT EXISTS guard_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  severity TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_ip TEXT,
  user_id TEXT,
  method TEXT,
  path TEXT,
  message TEXT NOT NULL,
  details TEXT,
  action_taken TEXT,
  acknowledged_at TEXT,
  acknowledged_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_guard_events_created ON guard_events (created_at);
CREATE INDEX IF NOT EXISTS idx_guard_events_kind ON guard_events (kind, created_at);
CREATE INDEX IF NOT EXISTS idx_guard_events_ip ON guard_events (source_ip, created_at);

CREATE TABLE IF NOT EXISTS guard_blocks (
  id TEXT PRIMARY KEY,
  ip TEXT NOT NULL,
  reason TEXT NOT NULL,
  event_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_guard_blocks_ip ON guard_blocks (ip, expires_at);

CREATE TABLE IF NOT EXISTS guard_scans (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  triggered_by TEXT NOT NULL,
  summary TEXT,
  findings TEXT
);
CREATE INDEX IF NOT EXISTS idx_guard_scans_kind ON guard_scans (kind, started_at);

CREATE TABLE IF NOT EXISTS guard_file_baseline (
  path TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guard_quarantine (
  id TEXT PRIMARY KEY,
  original_path TEXT NOT NULL,
  quarantine_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  reason TEXT NOT NULL,
  event_id TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  restored_at TEXT,
  restored_by TEXT
);

CREATE TABLE IF NOT EXISTS guard_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
