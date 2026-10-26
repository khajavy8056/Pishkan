CREATE TABLE IF NOT EXISTS compensation_contracts (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL, monthly_amount INTEGER NOT NULL DEFAULT 0,
 commission_percent INTEGER NOT NULL DEFAULT 0,
 starts_on TEXT NOT NULL, ends_on TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_contract_staff ON compensation_contracts(user_id, starts_on);
CREATE TABLE IF NOT EXISTS compensation_entries (
 id TEXT PRIMARY KEY, operation_key TEXT NOT NULL UNIQUE,
 user_id TEXT NOT NULL REFERENCES users(id), contract_id TEXT REFERENCES compensation_contracts(id),
 kind TEXT NOT NULL, amount INTEGER NOT NULL, period TEXT,
 payment_id TEXT REFERENCES payments(id), request_id TEXT REFERENCES requests(id),
 snapshot TEXT NOT NULL DEFAULT '{}', note TEXT,
 created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_compensation_staff ON compensation_entries(user_id,created_at);
