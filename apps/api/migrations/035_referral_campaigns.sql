CREATE TABLE referral_campaigns (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  threshold INTEGER NOT NULL CHECK (threshold > 0),
  reward_amount INTEGER NOT NULL CHECK (reward_amount > 0),
  max_rewards INTEGER NOT NULL CHECK (max_rewards > 0),
  paid_count INTEGER NOT NULL DEFAULT 0 CHECK (paid_count >= 0),
  starts_at TEXT,
  expires_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE referral_links (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES referral_campaigns(id),
  inviter_id TEXT NOT NULL REFERENCES users(id),
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE (campaign_id, inviter_id)
);
CREATE TABLE referral_attributions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES referral_campaigns(id),
  inviter_id TEXT NOT NULL REFERENCES users(id),
  invitee_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  created_at TEXT NOT NULL,
  qualified_at TEXT,
  CHECK (inviter_id <> invitee_id)
);
CREATE INDEX ix_referral_progress ON referral_attributions(campaign_id, inviter_id, qualified_at);
CREATE TABLE referral_rewards (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES referral_campaigns(id),
  inviter_id TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  wallet_transaction_id TEXT NOT NULL REFERENCES wallet_transactions(id),
  created_at TEXT NOT NULL,
  UNIQUE(campaign_id, inviter_id)
);
