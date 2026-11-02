-- Intelligent media pipeline for customer documents.
--
-- Design notes
--  * `files.storage_key` keeps pointing at the *served* version so every older
--    code path and every pre-existing row keeps working unchanged.
--  * `files.original_storage_key` is the immutable archive copy. It is written
--    once and never deleted automatically; if conversion fails the original
--    stays as the served version too.
--  * Processing state is persisted (pending | processing | ready | failed |
--    skipped) so a restart or a dropped connection cannot leave a document in
--    limbo.
ALTER TABLE files ADD COLUMN original_storage_key TEXT;
ALTER TABLE files ADD COLUMN original_mime TEXT;
ALTER TABLE files ADD COLUMN original_size INTEGER;
ALTER TABLE files ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE files ADD COLUMN processing_mode TEXT;
ALTER TABLE files ADD COLUMN processing_error TEXT;
ALTER TABLE files ADD COLUMN processing_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN processing_started_at TEXT;
ALTER TABLE files ADD COLUMN processed_at TEXT;
ALTER TABLE files ADD COLUMN preview_storage_key TEXT;
ALTER TABLE files ADD COLUMN width INTEGER;
ALTER TABLE files ADD COLUMN height INTEGER;
ALTER TABLE files ADD COLUMN original_width INTEGER;
ALTER TABLE files ADD COLUMN original_height INTEGER;
ALTER TABLE files ADD COLUMN savings_percent REAL;
ALTER TABLE files ADD COLUMN quality_score REAL;
ALTER TABLE files ADD COLUMN deduplicated_from TEXT;

CREATE INDEX IF NOT EXISTS ix_files_sha ON files (sha256);
CREATE INDEX IF NOT EXISTS ix_files_processing ON files (processing_status);

-- Profile-level document archive. Documents can be stored once and reused in
-- later requests, but only after an explicit customer confirmation and an
-- expiry check (both enforced in the service layer, not the UI).
CREATE TABLE IF NOT EXISTS customer_documents (
  id             TEXT PRIMARY KEY,
  customer_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id        TEXT NOT NULL REFERENCES files(id),
  doc_type       TEXT NOT NULL DEFAULT 'other',
  title          TEXT,
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  issued_at      TEXT,
  expires_at     TEXT,
  verified_by    TEXT,
  verified_at    TEXT,
  review_note    TEXT,
  request_id     TEXT REFERENCES requests(id) ON DELETE SET NULL,
  reused_from    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_customer_docs_customer ON customer_documents (customer_id, created_at);
CREATE INDEX IF NOT EXISTS ix_customer_docs_file ON customer_documents (file_id);

-- Traceability between a request document and the profile archive record it
-- was reused from, including the validity window at reuse time.
ALTER TABLE request_documents ADD COLUMN customer_document_id TEXT;
ALTER TABLE request_documents ADD COLUMN document_type TEXT;
ALTER TABLE request_documents ADD COLUMN expires_at TEXT;

-- Sensitive-access trail. Kept separate from audit_logs so document views do not
-- drown privileged administrative actions (and can be pruned independently).
CREATE TABLE IF NOT EXISTS file_access_logs (
  id         TEXT PRIMARY KEY,
  file_id    TEXT NOT NULL,
  actor_id   TEXT,
  actor_role TEXT,
  action     TEXT NOT NULL, -- view | preview | original | download
  variant    TEXT,
  ip         TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_file_access_file ON file_access_logs (file_id, created_at);
