-- Separate estimated completion from an explicit operational deadline, store
-- service durations at minute precision, and keep immutable document review
-- history for both request and profile documents.
ALTER TABLE services ADD COLUMN estimated_minutes INTEGER NOT NULL DEFAULT 4320;
ALTER TABLE services ADD COLUMN urgent_minutes INTEGER NOT NULL DEFAULT 1440;
UPDATE services SET estimated_minutes = estimated_days * 1440;
UPDATE services SET urgent_minutes = urgent_days * 1440;

ALTER TABLE requests ADD COLUMN estimated_completion_at TEXT;
-- All historical request due_at values were generated from service estimates;
-- preserve them as estimates and leave the real deadline unset.
UPDATE requests SET estimated_completion_at = due_at, due_at = NULL WHERE due_at IS NOT NULL;

ALTER TABLE request_documents ADD COLUMN requirement_key TEXT;
ALTER TABLE request_documents ADD COLUMN replaces_document_id TEXT REFERENCES request_documents(id) ON DELETE SET NULL;
ALTER TABLE customer_documents ADD COLUMN replaces_document_id TEXT REFERENCES customer_documents(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_request_document_single_replacement
  ON request_documents(replaces_document_id) WHERE replaces_document_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_document_single_replacement
  ON customer_documents(replaces_document_id) WHERE replaces_document_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS document_reviews (
  id TEXT PRIMARY KEY,
  request_document_id TEXT REFERENCES request_documents(id) ON DELETE CASCADE,
  customer_document_id TEXT REFERENCES customer_documents(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  note TEXT,
  reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewer_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK ((request_document_id IS NULL) <> (customer_document_id IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_document_reviews_request ON document_reviews(request_document_id, created_at);
CREATE INDEX IF NOT EXISTS ix_document_reviews_profile ON document_reviews(customer_document_id, created_at);
