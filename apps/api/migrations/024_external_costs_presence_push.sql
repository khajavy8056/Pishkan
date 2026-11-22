-- 024: external (organization) cost invoices, staff presence, withdrawal
-- receipts, web-push subscriptions and customer-initiated custom requests.

-- A service may carry organization fees (insurance premiums, duties, fines…)
-- that are NOT part of the office fee. The flag warns the customer up front;
-- predefined items inform the price breakdown; the exact per-person amount is
-- invoiced mid-process by the expert.
ALTER TABLE services ADD COLUMN has_external_costs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE services ADD COLUMN external_costs_note TEXT;
ALTER TABLE services ADD COLUMN external_cost_items TEXT NOT NULL DEFAULT '[]';

-- Invoices gain a purpose: 'service' (office revenue, commission basis) or
-- 'external_cost' (pass-through money owed to an organization — never revenue,
-- never part of any commission basis).
ALTER TABLE invoices ADD COLUMN purpose TEXT NOT NULL DEFAULT 'service';

-- Presence for fair automatic assignment ("is this person actually around?").
ALTER TABLE users ADD COLUMN last_seen_at TEXT;

-- Bank receipt evidence for a paid withdrawal.
ALTER TABLE staff_withdrawals ADD COLUMN receipt_file_id TEXT REFERENCES files(id) ON DELETE SET NULL;

-- The staff member who defines a custom offer may take the case themselves
-- once the customer accepts, instead of sending it to the free pool.
ALTER TABLE custom_service_offers ADD COLUMN assign_to_creator INTEGER NOT NULL DEFAULT 0;

-- Customer-initiated off-catalog requests ("my need is not in your list").
CREATE TABLE IF NOT EXISTS custom_requests (
  id            TEXT PRIMARY KEY,
  customer_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | priced | rejected | cancelled
  staff_note    TEXT,
  offer_id      TEXT REFERENCES custom_service_offers(id) ON DELETE SET NULL,
  handled_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_custom_requests_status ON custom_requests (status, created_at);
CREATE INDEX IF NOT EXISTS ix_custom_requests_customer ON custom_requests (customer_id, created_at);

-- Web Push: one VAPID key pair per installation + per-device subscriptions.
CREATE TABLE IF NOT EXISTS push_config (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  public_key  TEXT NOT NULL,
  private_key TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, endpoint)
);
CREATE INDEX IF NOT EXISTS ix_push_subscriptions_user ON push_subscriptions (user_id);
