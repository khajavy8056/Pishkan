-- Preserve the date/time requested for an additional shift; old requests remain valid.
ALTER TABLE shift_change_requests ADD COLUMN start_time TEXT;
ALTER TABLE shift_change_requests ADD COLUMN end_time TEXT;
