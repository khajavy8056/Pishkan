-- ============================================================================
-- 044_form_field_presets.sql
--
-- Reusable form-field definitions for the service editor.
--
-- ## The problem this solves
--
-- Defining a service's form meant typing every field by hand — `key`, Persian
-- label, type, required, placeholder, help — for the fortieth time, for «کد ملی»
-- and «نام و نام خانوادگی» and «تاریخ تولد» which every other service in the
-- catalogue already has. Two things went wrong because of that: the work was
-- slow, and the *standards drifted* — one service's national id field says
-- `national_id`, another says `melli`, and the profile-reuse and autofill logic
-- that keys off these names silently stops matching for half the catalogue.
--
-- So a field the office defines once should be *the* field, picked from a
-- palette next time instead of retyped. Most of that palette needs no table at
-- all: it is computed from the services that already exist (see
-- `modules/catalog/presets.ts`). What this table holds is the part a computed
-- scan cannot give you —
--
--  * a preset for a field nobody has saved in a service yet (drafted in the
--    editor, or worth keeping after the service that used it was archived);
--  * the *correction* an office makes once: «this is our standard for شماره
--    شناسنامه, with this help text» — which must survive even while no service
--    references it.
--
-- `key` is unique because it *is* the identity of a field: the request payload,
-- the profile columns, the assistant's autofill and the staff-side filters all
-- address a field by its key, so two presets with one key would put two
-- different standards into one catalogue.
--
-- `source` is kept rather than derived so the palette can say where a field came
-- from («در ۴ خدمت استفاده شده» vs «فیلد آمادهٔ خودتان») — a person deciding
-- whether to trust a preset cares about exactly that.
--
-- INTEGER/TEXT only; nothing here is dialect-specific, so the same file runs on
-- SQLite (office laptop / Windows test) and PostgreSQL (the real server).
-- ============================================================================

CREATE TABLE IF NOT EXISTS form_field_presets (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  type        TEXT NOT NULL,
  definition  TEXT NOT NULL,                 -- the full field JSON, ready to insert
  source      TEXT NOT NULL DEFAULT 'manual', -- manual | service | builtin
  use_count   INTEGER NOT NULL DEFAULT 0,    -- kept for ordering; recomputed on read
  created_by  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- The palette lists by type first (an office looking for «یک فایل» browses the
-- file fields), so the covering index is on (type, label).
CREATE INDEX IF NOT EXISTS ix_form_field_presets_type ON form_field_presets (type, label);
