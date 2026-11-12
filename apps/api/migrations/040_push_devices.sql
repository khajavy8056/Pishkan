-- Push notifications for the customer app (FCM) and device registration.
--
-- Why a table of its own rather than reusing push_subscriptions (Web Push):
-- the two channels have different identity, different failure modes and
-- different lifetimes. A Web Push subscription is a URL+keys pair owned by a
-- browser profile; an FCM registration token is a device installation that
-- Google reissues on reinstall, app-data clear, or after months of inactivity.
-- Mixing them would mean `DELETE ... WHERE token NOT IN` pruning one channel
-- with the other channel's IDs, which is how working devices get unsubscribed.
--
-- customer_devices: one row per app installation. A signed-in customer may have
-- several (phone + tablet). The token is unique across the whole table because
-- it identifies the install, not the account: when a second person signs in on
-- the same phone, the same token is reassigned to them rather than duplicated.
CREATE TABLE IF NOT EXISTS customer_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'android',
  app_version TEXT,
  device_name TEXT,
  -- The vendor ROMs that are known to freeze background work (Xiaomi, Oppo,
  -- Vivo, Samsung, Huawei). Recorded so the app can tell the customer exactly
  -- which switch to flip instead of a generic "enable battery saver off" note.
  device_maker TEXT,
  -- Consecutive FCM send failures. Three in a row means the token is dead
  -- (app uninstalled, data cleared, or Google rotated it) and the row is pruned.
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL,
  last_pushed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customer_devices_user ON customer_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_customer_devices_seen ON customer_devices(last_seen_at);

-- One row per push attempt, for the admin diagnostics screen and for the
-- "did the customer actually get it?" question that otherwise has no answer
-- short of asking them. Deliberately not a foreign key to customer_devices:
-- a pruned device must not erase the history of what was sent.
CREATE TABLE IF NOT EXISTS push_delivery_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  notification_id TEXT,
  device_token_tail TEXT,
  platform TEXT,
  -- fcm | web | none
  channel TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  -- FCM error code (UNREGISTERED, INVALID_ARGUMENT, QUOTA_EXCEEDED…) so a
  -- failing rollout can be diagnosed from the data instead of guesswork.
  error_code TEXT,
  error_text TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_delivery_created ON push_delivery_log(created_at);
CREATE INDEX IF NOT EXISTS idx_push_delivery_user ON push_delivery_log(user_id);
