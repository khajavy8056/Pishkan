-- ===========================================================================
-- 002_catalog.sql — service catalog, categories, dynamic forms
-- ===========================================================================

CREATE TABLE IF NOT EXISTS service_categories (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  description TEXT,
  icon        TEXT,
  color       TEXT,
  image       TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_categories_sort ON service_categories (sort_order);

CREATE TABLE IF NOT EXISTS services (
  id                  TEXT PRIMARY KEY,
  category_id         TEXT REFERENCES service_categories(id) ON DELETE SET NULL,
  slug                TEXT NOT NULL UNIQUE,
  title               TEXT NOT NULL,
  summary             TEXT,
  description         TEXT,
  image               TEXT,
  icon                TEXT,
  form_schema         TEXT NOT NULL DEFAULT '[]',
  documents           TEXT NOT NULL DEFAULT '[]',
  workflow_steps      TEXT NOT NULL DEFAULT '[]',
  base_fee            INTEGER NOT NULL DEFAULT 0,       -- Rial
  discount_percent    INTEGER NOT NULL DEFAULT 0,
  estimated_days      INTEGER NOT NULL DEFAULT 3,
  payment_methods     TEXT NOT NULL DEFAULT '["online","cash"]',
  tags                TEXT NOT NULL DEFAULT '[]',
  search_text         TEXT NOT NULL DEFAULT '',
  contact_notice      TEXT,
  is_published        INTEGER NOT NULL DEFAULT 1,
  accepting_requests  INTEGER NOT NULL DEFAULT 1,
  is_custom           INTEGER NOT NULL DEFAULT 0,
  owner_customer_id   TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_by          TEXT,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  needs_review        INTEGER NOT NULL DEFAULT 1,
  archived_at         TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_services_category ON services (category_id, sort_order);
CREATE INDEX IF NOT EXISTS ix_services_public ON services (is_published, accepting_requests);
CREATE INDEX IF NOT EXISTS ix_services_custom ON services (is_custom, owner_customer_id);

CREATE TABLE IF NOT EXISTS service_staff (
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  priority   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (service_id, user_id)
);

CREATE TABLE IF NOT EXISTS custom_service_offers (
  id          TEXT PRIMARY KEY,
  service_id  TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id  TEXT,
  invoice_id  TEXT,
  amount      INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending | accepted | declined | expired
  message     TEXT,
  expires_at  TEXT,
  created_by  TEXT,
  decided_at  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_offers_customer ON custom_service_offers (customer_id, status);
