-- ============================================================================
-- 021_support_tickets.sql
--
-- A real support-desk ("پشتیبانی") separate from per-request conversations:
-- customers open tickets by department with a priority, staff reply, assign
-- and close them, and the customer can rate the handling once resolved.
-- Ticket messages may carry one attachment (a row in `files`) and staff can
-- leave internal notes that the customer never sees.
-- ============================================================================

CREATE TABLE IF NOT EXISTS support_tickets (
  id             TEXT PRIMARY KEY,
  number         TEXT NOT NULL,                       -- human code, e.g. SUP-1042
  customer_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id     TEXT REFERENCES requests(id) ON DELETE SET NULL,
  department     TEXT NOT NULL DEFAULT 'general',     -- general | technical | financial | services | complaint
  subject        TEXT NOT NULL,
  priority       TEXT NOT NULL DEFAULT 'normal',      -- low | normal | high | urgent
  status         TEXT NOT NULL DEFAULT 'open',        -- open | answered | waiting_customer | resolved | closed
  assigned_to    TEXT REFERENCES users(id) ON DELETE SET NULL,
  rating         INTEGER,                             -- 1..5, set by the customer after resolve
  rating_note    TEXT,
  last_message_at TEXT,
  last_sender    TEXT,                                -- customer | staff
  resolved_at    TEXT,
  closed_at      TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_support_tickets_number ON support_tickets (number);
CREATE INDEX IF NOT EXISTS ix_support_tickets_customer ON support_tickets (customer_id, status, updated_at);
CREATE INDEX IF NOT EXISTS ix_support_tickets_queue ON support_tickets (status, priority, updated_at);
CREATE INDEX IF NOT EXISTS ix_support_tickets_assigned ON support_tickets (assigned_to, status);

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id           TEXT PRIMARY KEY,
  ticket_id    TEXT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role  TEXT NOT NULL,                          -- customer | staff | admin | system
  body         TEXT NOT NULL,
  file_id      TEXT REFERENCES files(id) ON DELETE SET NULL,
  is_internal  INTEGER NOT NULL DEFAULT 0,             -- staff-only note
  read_at      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_support_messages_ticket ON support_ticket_messages (ticket_id, created_at);
