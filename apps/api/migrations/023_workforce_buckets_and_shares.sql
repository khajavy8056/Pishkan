-- ============================================================================
-- 023_workforce_buckets_and_shares.sql
--
-- Three purely additive pieces for the workforce system:
--
-- 1) requests.work_bucket — a denormalised "whose move is it?" bucket derived
--    from the request status and the *kind* of its current workflow step
--    (action / in_progress / waiting_customer / waiting_organization /
--    followup / completed / cancelled). Staff queues, performance counters
--    and capacity maths all read this one column instead of re-deriving it.
--    Backfilled from status alone; the service recomputes it on every
--    status/step change from then on.
--
-- 2) staff_service_commissions — per-employee, per-service commission percent
--    overrides ("this expert gets 15% for tax cases, 10% otherwise"). When a
--    row exists it wins over the contract-wide percent at accrual time.
--
-- 3) request_commission_shares — manager-approved split of one request's
--    commission pool between several employees (percents of the pool, must
--    sum to 100). Editable only until the first commission entry exists for
--    the request, so recorded money is never silently redistributed.
-- ============================================================================

ALTER TABLE requests ADD COLUMN work_bucket TEXT NOT NULL DEFAULT 'action';

UPDATE requests SET work_bucket = CASE
  WHEN status = 'completed' THEN 'completed'
  WHEN status IN ('cancelled', 'rejected') THEN 'cancelled'
  WHEN status IN ('waiting_documents', 'waiting_customer') THEN 'waiting_customer'
  WHEN status = 'under_review' THEN 'waiting_organization'
  WHEN status = 'in_progress' THEN 'in_progress'
  ELSE 'action'
END;

CREATE INDEX IF NOT EXISTS idx_requests_assignee_bucket ON requests (assigned_to, work_bucket);

CREATE TABLE IF NOT EXISTS staff_service_commissions (
  user_id     TEXT NOT NULL REFERENCES users(id),
  service_id  TEXT NOT NULL REFERENCES services(id),
  percent     INTEGER NOT NULL,
  note        TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, service_id)
);

CREATE TABLE IF NOT EXISTS request_commission_shares (
  request_id    TEXT NOT NULL REFERENCES requests(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  share_percent INTEGER NOT NULL,
  note          TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  PRIMARY KEY (request_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_request_shares_user ON request_commission_shares (user_id);
