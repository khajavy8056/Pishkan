-- ============================================================================
-- 019_staff_earnings_and_withdrawals.sql
--
-- Staff cooperation types, auditable earnings ledger extensions, withdrawal
-- requests with their own event history, salary payments, forced-assignment
-- bookkeeping and claim attempts.
--
-- The migration is additive only: no column, row or historical amount is
-- dropped. Existing commission/salary entries keep working; the new columns
-- default to values that preserve their previous meaning.
-- ============================================================================

/* --------------------------- contracts & settings ------------------------- */

-- Per-employee settlement policy. The values are copied onto each earnings
-- entry when it is created, so a later change never rewrites history.
ALTER TABLE compensation_contracts ADD COLUMN settlement_period TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE compensation_contracts ADD COLUMN settlement_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE compensation_contracts ADD COLUMN min_withdrawal INTEGER NOT NULL DEFAULT 0;
-- Calculation rules for this employee (basis, rounding, notes) as JSON.
ALTER TABLE compensation_contracts ADD COLUMN rules TEXT NOT NULL DEFAULT '{}';
ALTER TABLE compensation_contracts ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
-- Who last edited the contract and why: salary/percentage history is evidence.
ALTER TABLE compensation_contracts ADD COLUMN note TEXT;
ALTER TABLE compensation_contracts ADD COLUMN updated_at TEXT;

/* --------------------------------- entries -------------------------------- */

-- The office revenue the share was computed from, and the percentage used.
ALTER TABLE compensation_entries ADD COLUMN basis_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE compensation_entries ADD COLUMN percent INTEGER NOT NULL DEFAULT 0;
-- The moment this income becomes withdrawable (end of its settlement period),
-- frozen at accrual time.
ALTER TABLE compensation_entries ADD COLUMN withdrawable_at TEXT;
-- Which withdrawal consumed this entry (set when the withdrawal is paid).
ALTER TABLE compensation_entries ADD COLUMN withdrawal_id TEXT;
-- Settlement period this entry belongs to, frozen at accrual time.
ALTER TABLE compensation_entries ADD COLUMN period_start TEXT;
ALTER TABLE compensation_entries ADD COLUMN period_end TEXT;
ALTER TABLE compensation_entries ADD COLUMN salary_payment_id TEXT;
CREATE INDEX IF NOT EXISTS ix_compensation_withdrawable
  ON compensation_entries (user_id, withdrawable_at);

/* ----------------------------- withdrawals -------------------------------- */

CREATE TABLE IF NOT EXISTS staff_withdrawals (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount         INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'submitted',
  -- settlement window this request covers (copied from the employee policy)
  period_start   TEXT,
  period_end     TEXT,
  requested_at   TEXT NOT NULL,
  request_note   TEXT,
  -- decision trail (who/when/why); the event table below keeps full history
  reviewed_by    TEXT,
  reviewed_at    TEXT,
  approved_by    TEXT,
  approved_at    TEXT,
  rejected_by    TEXT,
  rejected_at    TEXT,
  decision_note  TEXT,
  -- actual payment record; "paid" is only set together with these values
  paid_at        TEXT,
  payment_method TEXT,
  tracking_code  TEXT,
  accounting_note TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  CHECK (amount > 0),
  CHECK (status IN ('submitted','reviewing','approved','paying','paid','rejected','cancelled'))
);
CREATE INDEX IF NOT EXISTS ix_staff_withdrawals_user ON staff_withdrawals (user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_staff_withdrawals_status ON staff_withdrawals (status, created_at);

CREATE TABLE IF NOT EXISTS staff_withdrawal_events (
  id            TEXT PRIMARY KEY,
  withdrawal_id TEXT NOT NULL REFERENCES staff_withdrawals(id) ON DELETE CASCADE,
  action        TEXT NOT NULL,
  from_status   TEXT,
  to_status     TEXT,
  actor_id      TEXT,
  actor_name    TEXT,
  note          TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_withdrawal_events ON staff_withdrawal_events (withdrawal_id, created_at);

/* --------------------------- fixed salaries ------------------------------- */

CREATE TABLE IF NOT EXISTS staff_salary_payments (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_month  TEXT NOT NULL,               -- YYYY-MM
  amount        INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'paid', -- paid | pending | overdue
  method        TEXT,
  tracking_code TEXT,
  paid_at       TEXT,
  recorded_by   TEXT,
  recorded_name TEXT,
  note          TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS ix_salary_payments_user ON staff_salary_payments (user_id, period_month);

/* ------------------------ forced assignment / claims ----------------------- */

-- When the request must be taken away from the open pool (2/3 of its estimate
-- by default). NULL keeps historical requests out of the automatic sweep.
ALTER TABLE requests ADD COLUMN force_assign_at TEXT;
ALTER TABLE requests ADD COLUMN force_assigned_at TEXT;
ALTER TABLE requests ADD COLUMN force_assign_reason TEXT;
CREATE INDEX IF NOT EXISTS ix_requests_force_assign
  ON requests (assigned_to, force_assign_at);

-- Every claim attempt is recorded, including the ones that lose the race.
-- This is the audit trail for "someone else already accepted it".
CREATE TABLE IF NOT EXISTS request_claim_attempts (
  id         TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  staff_id   TEXT NOT NULL,
  staff_name TEXT,
  result     TEXT NOT NULL,                  -- won | conflict | ineligible | invalid
  reason     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_claim_attempts_request ON request_claim_attempts (request_id, created_at);
CREATE INDEX IF NOT EXISTS ix_claim_attempts_staff ON request_claim_attempts (staff_id, created_at);
