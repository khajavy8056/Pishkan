-- ===========================================================================
-- 003_operations.sql — requests, workflow, messaging
-- ===========================================================================

CREATE TABLE IF NOT EXISTS requests (
  id              TEXT PRIMARY KEY,
  tracking_code   TEXT NOT NULL UNIQUE,
  customer_id     TEXT NOT NULL REFERENCES users(id),
  service_id      TEXT NOT NULL REFERENCES services(id),
  assigned_to     TEXT REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'new',
  priority        TEXT NOT NULL DEFAULT 'normal',
  form_data       TEXT NOT NULL DEFAULT '{}',
  snapshot        TEXT NOT NULL DEFAULT '{}',   -- immutable service + customer data at submit time
  fee             INTEGER NOT NULL DEFAULT 0,
  discount        INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL DEFAULT 0,
  payment_method  TEXT NOT NULL DEFAULT 'online',
  payment_status  TEXT NOT NULL DEFAULT 'unpaid', -- unpaid | partial | paid | refunded
  current_step    INTEGER NOT NULL DEFAULT 0,
  due_at          TEXT,
  rejected_reason TEXT,
  completed_at    TEXT,
  cancelled_at    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_requests_customer ON requests (customer_id, created_at);
CREATE INDEX IF NOT EXISTS ix_requests_assigned ON requests (assigned_to, status);
CREATE INDEX IF NOT EXISTS ix_requests_status ON requests (status, created_at);
CREATE INDEX IF NOT EXISTS ix_requests_service ON requests (service_id);

CREATE TABLE IF NOT EXISTS request_events (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  actor_id    TEXT,
  actor_name  TEXT,
  type        TEXT NOT NULL,        -- created | assigned | status | note | document | payment | invoice | system
  message     TEXT,
  from_status TEXT,
  to_status   TEXT,
  metadata    TEXT NOT NULL DEFAULT '{}',
  visible_to_customer INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_request_events ON request_events (request_id, created_at);

CREATE TABLE IF NOT EXISTS request_documents (
  id           TEXT PRIMARY KEY,
  request_id   TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  file_id      TEXT NOT NULL REFERENCES files(id),
  title        TEXT,
  kind         TEXT NOT NULL DEFAULT 'other',
  status       TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  reviewed_by  TEXT,
  review_note  TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_request_docs ON request_documents (request_id);

CREATE TABLE IF NOT EXISTS threads (
  id          TEXT PRIMARY KEY,
  scope       TEXT NOT NULL DEFAULT 'general',   -- general | request | custom_offer
  request_id  TEXT REFERENCES requests(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject     TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  assigned_to TEXT,
  last_message_at TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_threads_customer ON threads (customer_id, last_message_at);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  thread_id  TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  sender_id  TEXT,
  sender_role TEXT NOT NULL,       -- customer | staff | admin | system
  body       TEXT NOT NULL,
  file_id    TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_messages_thread ON messages (thread_id, created_at);
