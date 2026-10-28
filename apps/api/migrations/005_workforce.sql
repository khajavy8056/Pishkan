-- ===========================================================================
-- 005_workforce.sql — shifts, attendance, assignments
-- ===========================================================================

CREATE TABLE IF NOT EXISTS shift_templates (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  start_time TEXT NOT NULL,   -- HH:MM
  end_time   TEXT NOT NULL,   -- HH:MM
  weekdays   TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
  capacity   INTEGER NOT NULL DEFAULT 10,
  color      TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shifts (
  id          TEXT PRIMARY KEY,
  template_id TEXT REFERENCES shift_templates(id) ON DELETE SET NULL,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_date  TEXT NOT NULL,        -- YYYY-MM-DD
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | completed | absent | leave
  note        TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_shifts_date ON shifts (shift_date);
CREATE INDEX IF NOT EXISTS ix_shifts_user ON shifts (user_id, shift_date);

CREATE TABLE IF NOT EXISTS attendance (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_id   TEXT REFERENCES shifts(id) ON DELETE SET NULL,
  check_in   TEXT,
  check_out  TEXT,
  status     TEXT NOT NULL DEFAULT 'present', -- present | late | absent | leave | remote
  minutes_late INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_attendance_user ON attendance (user_id, check_in);

CREATE TABLE IF NOT EXISTS shift_change_requests (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shift_id    TEXT REFERENCES shifts(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL DEFAULT 'swap',    -- swap | leave | add
  requested_date TEXT,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  decided_by  TEXT,
  decided_at  TEXT,
  decision_note TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_shift_requests ON shift_change_requests (status, created_at);

CREATE TABLE IF NOT EXISTS assignment_rules (
  id          TEXT PRIMARY KEY,
  service_id  TEXT REFERENCES services(id) ON DELETE CASCADE,
  strategy    TEXT NOT NULL DEFAULT 'round_robin', -- round_robin | least_loaded | fixed | pool
  staff_ids   TEXT NOT NULL DEFAULT '[]',
  max_load    INTEGER NOT NULL DEFAULT 0,          -- 0 = use staff profile limit
  fallback    TEXT NOT NULL DEFAULT 'queue',       -- queue | admin | any_staff
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_assignment_rule_service ON assignment_rules (service_id);
