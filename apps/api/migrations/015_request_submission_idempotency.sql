-- Persist client submission keys so browser retries cannot create duplicate cases.
CREATE TABLE IF NOT EXISTS request_submission_keys (
  customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  request_id TEXT UNIQUE REFERENCES requests(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (customer_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ix_request_submission_keys_request
  ON request_submission_keys (request_id);
