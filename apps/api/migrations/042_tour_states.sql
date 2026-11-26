-- ============================================================================
-- 042_tour_states.sql
--
-- Per-user state for the guided tours («راهنمای تصویری») and for the short
-- contextual tips that appear after a repeated wrong action.
--
-- The tour *copy* lives in the application (modules/tours/catalog.ts) and is
-- served to both clients, so web and Android explain the same screen with the
-- same words; only «who has seen what» is stored here. Two rows per concern on
-- purpose:
--
--  * user_tour_states — one row per (person, tour). `dismissed` and `completed`
--    are separate because «نه، الان وقتش را ندارم» and «انجامش دادم» must not
--    behave alike: a dismissal can be offered again after a while, a completion
--    never re-starts on its own.
--  * user_tour_hints — one row per (person, hint). A tip is earned by repetition
--    (`occurrences`) and budgeted per day (`shown_today`, `last_day`), which is
--    what keeps a smart tip from becoming a nag.
--
-- INTEGER/TEXT only: the same file has to run on SQLite and PostgreSQL.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_tour_states (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tour_code  TEXT NOT NULL,
  step       INTEGER NOT NULL DEFAULT 0,
  completed  INTEGER NOT NULL DEFAULT 0,
  dismissed  INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, tour_code)
);

CREATE TABLE IF NOT EXISTS user_tour_hints (
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hint_key              TEXT NOT NULL,
  occurrences           INTEGER NOT NULL DEFAULT 0,
  shown_count           INTEGER NOT NULL DEFAULT 0,
  last_shown_occurrence INTEGER NOT NULL DEFAULT 0,
  shown_today           INTEGER NOT NULL DEFAULT 0,
  last_day              TEXT,
  updated_at            TEXT NOT NULL,
  PRIMARY KEY (user_id, hint_key)
);

CREATE INDEX IF NOT EXISTS idx_user_tour_states_user ON user_tour_states(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tour_hints_user ON user_tour_hints(user_id);
