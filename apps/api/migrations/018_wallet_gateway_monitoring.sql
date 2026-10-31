-- =============================================================================
-- 018_wallet_gateway_monitoring.sql
--
-- Adds three additive subsystems:
--   1. customer wallet (double-entry style ledger of wallet movements)
--   2. payment provider bookkeeping (callback audit trail, top-up purpose)
--   3. structured system logs, metric samples and operational alerts
--
-- No existing table is dropped or re-typed. Historical payment rows keep their
-- legacy `method` values (cash/pos/transfer) so old reports stay readable; the
-- application simply refuses to create new ones.
-- =============================================================================

/* ------------------------------- payments -------------------------------- */

-- invoice (default) | wallet_topup
ALTER TABLE payments ADD COLUMN purpose TEXT NOT NULL DEFAULT 'invoice';
ALTER TABLE payments ADD COLUMN wallet_id TEXT;
-- Provider side reference (PSP transaction id) kept apart from our own reference.
ALTER TABLE payments ADD COLUMN provider_reference TEXT;

CREATE INDEX IF NOT EXISTS ix_payments_wallet ON payments (wallet_id, created_at);
CREATE INDEX IF NOT EXISTS ix_payments_purpose ON payments (purpose, status);

/* --------------------------------- wallet -------------------------------- */

CREATE TABLE IF NOT EXISTS wallets (
  id          TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  currency    TEXT NOT NULL DEFAULT 'IRR',
  balance     INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  CHECK (balance >= 0)
);
CREATE INDEX IF NOT EXISTS ix_wallets_status ON wallets (status);

-- Immutable wallet ledger. Rows are never updated in place: a correction is a
-- new row (`type='correction'`, `reverses_transaction_id` set) so history stays
-- complete. `idempotency_key` makes gateway callbacks and retries safe.
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id                      TEXT PRIMARY KEY,
  wallet_id               TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  customer_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                    TEXT NOT NULL CHECK (type IN ('topup','purchase','refund','admin_credit','gift','correction')),
  direction               TEXT NOT NULL CHECK (direction IN ('credit','debit')),
  amount                  INTEGER NOT NULL CHECK (amount > 0),
  balance_before          INTEGER NOT NULL CHECK (balance_before >= 0),
  balance_after           INTEGER NOT NULL CHECK (balance_after >= 0),
  source                  TEXT NOT NULL DEFAULT 'system' CHECK (source IN ('gateway','wallet','admin','system')),
  status                  TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','reversed')),
  payment_id              TEXT REFERENCES payments(id) ON DELETE SET NULL,
  invoice_id              TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  request_id              TEXT REFERENCES requests(id) ON DELETE SET NULL,
  admin_id                TEXT REFERENCES users(id) ON DELETE SET NULL,
  admin_name              TEXT,
  reason                  TEXT,
  description             TEXT,
  tracking_code           TEXT NOT NULL UNIQUE,
  idempotency_key         TEXT UNIQUE,
  reverses_transaction_id TEXT REFERENCES wallet_transactions(id) ON DELETE SET NULL,
  created_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_wallet_tx_wallet ON wallet_transactions (wallet_id, created_at);
CREATE INDEX IF NOT EXISTS ix_wallet_tx_customer ON wallet_transactions (customer_id, created_at);
CREATE INDEX IF NOT EXISTS ix_wallet_tx_payment ON wallet_transactions (payment_id);
CREATE INDEX IF NOT EXISTS ix_wallet_tx_request ON wallet_transactions (request_id);
CREATE INDEX IF NOT EXISTS ix_wallet_tx_type ON wallet_transactions (type, created_at);
CREATE INDEX IF NOT EXISTS ix_wallet_tx_admin ON wallet_transactions (admin_id, created_at);

/* ---------------------------- gateway callbacks --------------------------- */

-- Every inbound gateway interaction is recorded before it can change money.
-- `status` is our decision (accepted | rejected | duplicate | error), `code` is
-- the provider code. Raw payloads are never stored.
CREATE TABLE IF NOT EXISTS payment_callbacks (
  id         TEXT PRIMARY KEY,
  payment_id TEXT REFERENCES payments(id) ON DELETE SET NULL,
  provider   TEXT NOT NULL,
  event      TEXT NOT NULL,
  status     TEXT NOT NULL,
  code       TEXT,
  reference  TEXT,
  ip         TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_payment_callbacks_payment ON payment_callbacks (payment_id, created_at);
CREATE INDEX IF NOT EXISTS ix_payment_callbacks_provider ON payment_callbacks (provider, created_at);

/* ----------------------------- structured logs ---------------------------- */

CREATE TABLE IF NOT EXISTS system_logs (
  id             TEXT PRIMARY KEY,
  created_at     TEXT NOT NULL,
  level          TEXT NOT NULL CHECK (level IN ('DEBUG','INFO','WARNING','ERROR','CRITICAL','SECURITY')),
  category       TEXT NOT NULL,
  action         TEXT NOT NULL,
  actor_id       TEXT,
  actor_name     TEXT,
  actor_role     TEXT,
  ip             TEXT,
  request_id     TEXT,
  correlation_id TEXT,
  entity_type    TEXT,
  entity_id      TEXT,
  transaction_id TEXT,
  result         TEXT NOT NULL DEFAULT 'success' CHECK (result IN ('success','failure','denied')),
  message        TEXT,
  error_code     TEXT,
  details        TEXT,
  duration_ms    INTEGER,
  source         TEXT NOT NULL DEFAULT 'api'
);
CREATE INDEX IF NOT EXISTS ix_system_logs_created ON system_logs (created_at);
CREATE INDEX IF NOT EXISTS ix_system_logs_level ON system_logs (level, created_at);
CREATE INDEX IF NOT EXISTS ix_system_logs_category ON system_logs (category, created_at);
CREATE INDEX IF NOT EXISTS ix_system_logs_actor ON system_logs (actor_id, created_at);
CREATE INDEX IF NOT EXISTS ix_system_logs_request ON system_logs (request_id);
CREATE INDEX IF NOT EXISTS ix_system_logs_entity ON system_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS ix_system_logs_txn ON system_logs (transaction_id);

/* ------------------------------ metric samples ---------------------------- */

-- Values are integers scaled per metric (percent × 100, milliseconds, counts).
-- Keeps the shared SQL dialect free of REAL/FLOAT differences.
CREATE TABLE IF NOT EXISTS metric_samples (
  id          TEXT PRIMARY KEY,
  metric      TEXT NOT NULL,
  value       INTEGER NOT NULL,
  captured_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_metric_samples_metric ON metric_samples (metric, captured_at);

/* --------------------------------- alerts -------------------------------- */

CREATE TABLE IF NOT EXISTS alerts (
  id              TEXT PRIMARY KEY,
  alert_key       TEXT NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  category        TEXT NOT NULL,
  title           TEXT NOT NULL,
  message         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','acknowledged','resolved')),
  occurrences     INTEGER NOT NULL DEFAULT 1,
  first_seen_at   TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  resolved_at     TEXT,
  resolved_by     TEXT,
  metadata        TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_alerts_status ON alerts (status, last_seen_at);
CREATE INDEX IF NOT EXISTS ix_alerts_key ON alerts (alert_key, status);

/* -------------------- retire legacy customer payment methods -------------- */
-- Service configuration is not financial history: cash/POS/transfer are no
-- longer offered. Old request/payment rows keep their original values.

UPDATE services SET payment_methods = '["online","wallet"]' WHERE payment_methods IN (
  '["online","cash"]', '["cash","online"]', '["online","cash","pos"]', '["cash"]',
  '["cash","pos"]', '["pos"]', '["transfer"]', '["online","cash","pos","transfer"]',
  '["cash","online","pos"]'
);

UPDATE settings SET value = 'false', updated_at = updated_at WHERE key = 'accounting.cash_payment_enabled';
