-- ============================================================================
-- 041_assistant_drafts.sql
--
-- Guided request drafts for the smart assistant (web + Android).
--
-- The assistant walks a signed-in customer through a service form, shows a
-- full preview and only creates the real request after an explicit
-- confirmation. The draft itself never becomes a request on its own, so it is
-- stored outside `requests` and carries its own lifecycle in `state` JSON.
--
-- One row per customer: a customer has at most one assistant draft in flight
-- (starting a new one replaces the previous). The row is deleted on cancel and
-- on successful submission, and `updated_at` lets a sweep drop abandoned
-- drafts. `state` holds the draft, never credentials or payment details.
-- ============================================================================

CREATE TABLE IF NOT EXISTS assistant_drafts (
  id          TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  state       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assistant_drafts_updated ON assistant_drafts(updated_at);
