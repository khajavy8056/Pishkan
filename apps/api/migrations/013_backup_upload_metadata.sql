-- Bind upload archives to the database backup row so retention and verification
-- cannot silently treat a database-only copy as a complete backup set.
ALTER TABLE backups ADD COLUMN uploads_filename TEXT;
ALTER TABLE backups ADD COLUMN uploads_size INTEGER NOT NULL DEFAULT 0;
ALTER TABLE backups ADD COLUMN uploads_checksum TEXT;
