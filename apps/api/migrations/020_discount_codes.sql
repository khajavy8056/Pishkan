-- ============================================================================
-- 020_discount_codes.sql
--
-- Customer-facing discount codes ("کد تخفیف") that can be applied while a
-- service request is being priced. A code is either a percentage off the
-- service fee (with an optional cap) or a fixed amount off. Usage is limited
-- globally and per customer, can be scoped to one service or one category,
-- can require a minimum payable amount and can expire.
--
-- Redemptions are written to `discount_code_usages` inside the same
-- transaction that creates the request, so a rolled-back request never
-- consumes a code.
-- ============================================================================

CREATE TABLE IF NOT EXISTS discount_codes (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL,
  title             TEXT NOT NULL,
  type              TEXT NOT NULL DEFAULT 'percent',   -- percent | fixed
  value             INTEGER NOT NULL,                  -- percent 1..100 or IRR amount
  max_discount      INTEGER,                           -- cap for percent codes (IRR), NULL = uncapped
  min_amount        INTEGER NOT NULL DEFAULT 0,        -- minimum subtotal before this code (IRR)
  usage_limit       INTEGER,                           -- total redemptions, NULL = unlimited
  per_customer_limit INTEGER NOT NULL DEFAULT 1,       -- redemptions per customer
  used_count        INTEGER NOT NULL DEFAULT 0,
  service_id        TEXT REFERENCES services(id) ON DELETE SET NULL,
  category_id       TEXT REFERENCES service_categories(id) ON DELETE SET NULL,
  starts_at         TEXT,
  expires_at        TEXT,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_by        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_discount_codes_code ON discount_codes (code);
CREATE INDEX IF NOT EXISTS ix_discount_codes_active ON discount_codes (is_active, expires_at);

CREATE TABLE IF NOT EXISTS discount_code_usages (
  id          TEXT PRIMARY KEY,
  code_id     TEXT NOT NULL REFERENCES discount_codes(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id  TEXT REFERENCES requests(id) ON DELETE SET NULL,
  invoice_id  TEXT REFERENCES invoices(id) ON DELETE SET NULL,
  amount      INTEGER NOT NULL,                        -- IRR actually discounted
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_discount_usages_code ON discount_code_usages (code_id, created_at);
CREATE INDEX IF NOT EXISTS ix_discount_usages_customer ON discount_code_usages (customer_id, code_id);
