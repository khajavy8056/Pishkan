-- Persist assignment time so round-robin routing can rotate fairly across restarts.
ALTER TABLE requests ADD COLUMN assigned_at TEXT;
UPDATE requests SET assigned_at = updated_at WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_requests_service_assignment_rotation
  ON requests (service_id, assigned_to, assigned_at);
