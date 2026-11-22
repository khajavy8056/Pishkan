-- 028: native Android customer app (1.4.0)
-- Stories/announcements shown inside the customer app and a registry of the
-- devices that connect with it. The app uses the very same users, requests
-- and payments as the web panel; nothing about these tables duplicates them.
-- Stories are managed from the web admin panel («اپ اندروید») and served to
-- signed-in customers only; media stays a private uploaded file.

CREATE TABLE IF NOT EXISTS app_stories (
  id TEXT PRIMARY KEY,
  group_title TEXT,
  title TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'image', -- image | video
  file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  media_url TEXT,
  link_url TEXT,
  link_label TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 6,
  sort_order INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'published', -- draft | published
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_app_stories_active ON app_stories (status, sort_order, created_at);

CREATE TABLE IF NOT EXISTS app_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  app_version TEXT,
  app_build TEXT,
  device_model TEXT,
  push_token TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (user_id, device_id)
);
CREATE INDEX IF NOT EXISTS ix_app_devices_last_seen ON app_devices (last_seen_at);
CREATE INDEX IF NOT EXISTS ix_app_devices_user ON app_devices (user_id);
