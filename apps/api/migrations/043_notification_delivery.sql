-- ============================================================================
-- 043_notification_delivery.sql
--
-- Delivery bookkeeping for notifications: which notice has actually been
-- *confirmed on a device*, and how many times the server tried to reach it.
--
-- ## The problem this solves
--
-- A notice is now sent over several channels at once — FCM to the phone, Web
-- Push to the browser, the live stream to whatever is connected, periodic
-- polling as the floor — because in Iran no single one of them is dependable
-- (Google's geo-restrictions, battery-optimised vendors, a LAN-only office with
-- no outbound internet at all). Sending the same notice four times is only
-- correct if the device shows it once. Two halves make that work:
--
--  * immediately after the fact, the tag/collapse key and the app's own seen
--    list mean the *person* gets one banner, not four;
--  * afterwards, `notification_acks` is the durable answer to "did this ever
--    reach a device?", which is what tells the retry sweeper to stop and tells
--    the live stream and the poll not to re-announce something the tray already
--    showed. Acks arrive from the device, not from a provider: FCM accepting a
--    message is not proof that a phone displayed it, and treating the 200 as one
--    is how an app reports "sent" forever while a customer receives nothing.
--
-- `delivered_at` is denormalised onto the row so "find the notices nobody ever
-- received" is one indexed scan instead of an anti-join over a growing log, and
-- `push_attempts`/`push_last_at` are what let a retry back off instead of
-- hammering a device that is switched off at 3am.
--
-- INTEGER/TEXT only, no `UPDATE … FROM`: the same file has to run on SQLite and
-- PostgreSQL.
-- ============================================================================

CREATE TABLE IF NOT EXISTS notification_acks (
  id              TEXT PRIMARY KEY,
  notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,
  -- fcm | web | live | poll | sms | relay — the channel the device answered on.
  channel         TEXT NOT NULL,
  -- Which installation answered. '*' for a browser page or an app that does not
  -- have a registered device row: the ack is then per-notice, which is what the
  -- retry sweeper needs.
  device_ref      TEXT NOT NULL DEFAULT '*',
  acked_at        TEXT NOT NULL
);

-- One ack per (notice, channel, installation): a device that acks twice because
-- it was woken by both the push and the poll must not create a second row.
CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_acks_once
  ON notification_acks (notification_id, channel, device_ref);
CREATE INDEX IF NOT EXISTS ix_notification_acks_user ON notification_acks (user_id, acked_at);
CREATE INDEX IF NOT EXISTS ix_notification_acks_note ON notification_acks (notification_id);

ALTER TABLE notifications ADD COLUMN delivered_at TEXT;
ALTER TABLE notifications ADD COLUMN push_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notifications ADD COLUMN push_last_at TEXT;

-- The queue the sweeper reads: notices that are still waiting for a device to
-- answer, oldest first, bounded by the horizon it will not retry past.
CREATE INDEX IF NOT EXISTS ix_notifications_undelivered
  ON notifications (delivered_at, created_at);
