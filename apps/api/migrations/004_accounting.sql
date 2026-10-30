-- ===========================================================================
-- 004_accounting.sql — invoices, payments, expenses, ledger
-- ===========================================================================

CREATE TABLE IF NOT EXISTS invoices (
  id             TEXT PRIMARY KEY,
  number         TEXT NOT NULL UNIQUE,
  customer_id    TEXT NOT NULL REFERENCES users(id),
  request_id     TEXT REFERENCES requests(id) ON DELETE SET NULL,
  service_id     TEXT REFERENCES services(id) ON DELETE SET NULL,
  custom_offer_id TEXT,
  kind           TEXT NOT NULL DEFAULT 'public',   -- public | custom
  title          TEXT,
  items          TEXT NOT NULL DEFAULT '[]',       -- [{title, qty, unit_price, amount}]
  subtotal       INTEGER NOT NULL DEFAULT 0,
  discount       INTEGER NOT NULL DEFAULT 0,
  tax            INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL DEFAULT 0,
  paid_amount    INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'issued',   -- draft | issued | partially_paid | paid | void
  due_at         TEXT,
  notes          TEXT,
  issued_by      TEXT,
  issued_at      TEXT NOT NULL,
  voided_at      TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_invoices_customer ON invoices (customer_id, created_at);
CREATE INDEX IF NOT EXISTS ix_invoices_status ON invoices (status);
CREATE INDEX IF NOT EXISTS ix_invoices_request ON invoices (request_id);

CREATE TABLE IF NOT EXISTS payments (
  id             TEXT PRIMARY KEY,
  invoice_id     TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  request_id     TEXT REFERENCES requests(id) ON DELETE SET NULL,
  customer_id    TEXT NOT NULL REFERENCES users(id),
  amount         INTEGER NOT NULL,
  method         TEXT NOT NULL,                    -- online | cash | pos | transfer
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending | confirmed | failed | refunded | cancelled
  reference      TEXT,
  gateway        TEXT,
  gateway_authority TEXT,
  paid_at        TEXT,
  confirmed_by   TEXT,
  note           TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_payments_customer ON payments (customer_id, created_at);
CREATE INDEX IF NOT EXISTS ix_payments_invoice ON payments (invoice_id);
CREATE INDEX IF NOT EXISTS ix_payments_status ON payments (status);

CREATE TABLE IF NOT EXISTS expense_categories (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id            TEXT PRIMARY KEY,
  category_id   TEXT REFERENCES expense_categories(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  amount        INTEGER NOT NULL,
  spent_on      TEXT NOT NULL,
  method        TEXT,
  reference     TEXT,
  note          TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_expenses_date ON expenses (spent_on);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id            TEXT PRIMARY KEY,
  entry_date    TEXT NOT NULL,
  account       TEXT NOT NULL,          -- revenue:<serviceId> | cost:gateway | receivable | expense:<cat>
  direction     TEXT NOT NULL,          -- debit | credit
  amount        INTEGER NOT NULL,
  ref_type      TEXT,
  ref_id        TEXT,
  description   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ledger_date ON ledger_entries (entry_date);
CREATE INDEX IF NOT EXISTS ix_ledger_ref ON ledger_entries (ref_type, ref_id);

CREATE TABLE IF NOT EXISTS payment_gateway_logs (
  id          TEXT PRIMARY KEY,
  gateway     TEXT NOT NULL,
  amount      INTEGER,
  authority   TEXT,
  ref_id      TEXT,
  status      TEXT,
  raw         TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoice_sequences (
  scope   TEXT PRIMARY KEY,
  value   INTEGER NOT NULL DEFAULT 0
);
