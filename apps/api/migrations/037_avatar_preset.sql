-- Avatar choice for the customer app.
--
-- `users.avatar_file_id` already held an uploaded photo, but the picker the app
-- ships also offers 24 illustrated presets. Without a column for the preset the
-- app's PUT /api/customers/me/avatar/preset had nowhere to write, which is why
-- choosing a face never stuck. 0 means "no preset chosen".
ALTER TABLE users ADD COLUMN avatar_preset INTEGER NOT NULL DEFAULT 0;
