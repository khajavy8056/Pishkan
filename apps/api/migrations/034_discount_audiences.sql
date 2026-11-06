-- Existing codes stay unlisted. Administrators opt in to public, first-purchase
-- or individually assigned campaigns rather than exposing old private codes.
ALTER TABLE discount_codes ADD COLUMN audience TEXT NOT NULL DEFAULT 'code';
CREATE TABLE IF NOT EXISTS discount_assignments (
  code_id TEXT NOT NULL REFERENCES discount_codes(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(code_id, customer_id)
);
CREATE INDEX IF NOT EXISTS ix_discount_assignments_customer ON discount_assignments(customer_id, code_id);
