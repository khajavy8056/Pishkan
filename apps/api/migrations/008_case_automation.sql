-- Additive case handoff/approval history. No existing records are rewritten.
CREATE TABLE IF NOT EXISTS request_handoffs (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES requests(id),
 department TEXT NOT NULL CHECK(department IN ('management','accounting')),
 reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','returned')),
 created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
 decided_by TEXT REFERENCES users(id), decided_at TEXT, decision_note TEXT
);
CREATE INDEX IF NOT EXISTS ix_handoffs_inbox ON request_handoffs(department,status,created_at);
CREATE INDEX IF NOT EXISTS ix_handoffs_case ON request_handoffs(request_id);
