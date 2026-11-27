-- 048: organizational mailboxes on the office's own domain.
--
-- The actual mail server (docker-mailserver) is provisioned on the VPS during
-- the install phase by `pishkan-mail`. This table is the product-side registry
-- the admin UI reads/writes; provisioning calls the root-only `pishkan-mail`
-- CLI through a scoped sudo rule. Passwords are NEVER stored here — they live
-- only in the mail server's own account store.

CREATE TABLE IF NOT EXISTS mailboxes (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,             -- full address, e.g. admin@office.ir
  local_part TEXT NOT NULL,          -- the part before @
  domain TEXT NOT NULL,              -- the organizational domain suffix
  display_name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mailboxes_address ON mailboxes (address);
CREATE INDEX IF NOT EXISTS ix_mailboxes_domain ON mailboxes (domain, created_at);
