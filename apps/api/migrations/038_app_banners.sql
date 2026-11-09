-- 038: the customer app shows banners instead of stories.
--
-- A story was a vertical full-screen slide; a banner is a wide card on the
-- home screen that can advertise a service and open it. The table is new
-- rather than a rename of app_stories because the shape genuinely differs:
-- there is no duration, no media type to switch on, and the destination is
-- structured (kind + target) rather than a free link. Existing story rows are
-- carried over below so an office that already published notices does not
-- lose them, and app_stories is kept untouched as an archive.
--
-- destination_kind decides what tapping the banner does:
--   none    — nothing; the banner is purely informational
--   service — open that service in the app (destination_slug)
--   url     — open a page inside the app or the browser (destination_url)
-- The service reference is a slug, not an id, because the app navigates by
-- slug and a slug survives a catalogue reseed.

CREATE TABLE IF NOT EXISTS app_banners (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'general',      -- general | info | ad | service
  title TEXT NOT NULL,
  subtitle TEXT,
  -- Media is either an uploaded file (private, streamed through the API) or a
  -- URL. Default artwork shipped with the panel lives under relative paths.
  image_file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  image_url TEXT,
  -- A short accent gradient when a banner has no photo of its own.
  accent_color TEXT,
  destination_kind TEXT NOT NULL DEFAULT 'none',  -- none | service | url
  destination_slug TEXT,
  destination_url TEXT,
  action_label TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'published',        -- draft | published
  notify_customers INTEGER NOT NULL DEFAULT 0,
  notified_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_app_banners_active ON app_banners (status, sort_order, created_at);
CREATE INDEX IF NOT EXISTS ix_app_banners_schedule ON app_banners (starts_at, expires_at);

-- Carry the existing stories across as informational banners so the home
-- screen of an office that already has content is not empty after the
-- upgrade. Only runs when no banner exists yet: re-running the migration is
-- prevented by schema_migrations, but a manual re-run must be harmless.
INSERT INTO app_banners
  (id, kind, title, subtitle, image_file_id, image_url, accent_color,
   destination_kind, destination_slug, destination_url, action_label,
   sort_order, starts_at, expires_at, status, notify_customers, created_at, updated_at)
SELECT
  'banner-' || id, 'info', title, caption, file_id, media_url, NULL,
  'none', NULL, link_url, link_label,
  sort_order, starts_at, expires_at, status, 0, created_at, updated_at
FROM app_stories
WHERE NOT EXISTS (SELECT 1 FROM app_banners);
