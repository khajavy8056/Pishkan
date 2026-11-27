-- 046: off-server backup transfers (SFTP / FTP(S) / Google Drive).
-- One row per uploaded part; the local backup row stays the source of truth.

CREATE TABLE IF NOT EXISTS backup_transfers (
  id TEXT PRIMARY KEY,
  backup_id TEXT NOT NULL,
  target TEXT NOT NULL,
  filename TEXT NOT NULL,
  remote_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  checksum TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backup_transfers_backup ON backup_transfers (backup_id, created_at);
CREATE INDEX IF NOT EXISTS idx_backup_transfers_created ON backup_transfers (created_at);
