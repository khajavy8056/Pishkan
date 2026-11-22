-- 026: staff/admin dashboard data support (1.4.0)
--  * request_declines — an employee may decline a case in the free pool; the
--    case leaves THEIR queue only (other colleagues and the automatic
--    assignment are unaffected, so a decline can never starve a request).
--  * compensation_contracts.monthly_target — optional monthly income goal for
--    percentage employees, set by the admin on the contract. NULL = no goal.
CREATE TABLE IF NOT EXISTS request_declines (
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (request_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_request_declines_user ON request_declines(user_id);

ALTER TABLE compensation_contracts ADD COLUMN monthly_target INTEGER;
