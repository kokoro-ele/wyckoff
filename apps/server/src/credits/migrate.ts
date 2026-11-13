import type { Pool } from "pg";

/**
 * Creates the permanent-analysis-credit ledger.
 *
 * Existing installations keep their historical rows. New tables use cascading
 * FKs so account deletion cannot get stuck on old credit or referral records.
 */
export async function migrateCredits(pool: Pool) {
  await pool.query(`
CREATE TABLE IF NOT EXISTS user_identity(
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  public_id TEXT NOT NULL UNIQUE,
  ordinal INTEGER NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_referral_intents(
  token_hash TEXT PRIMARY KEY,
  invite_code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_referral_intents_expires ON auth_referral_intents(expires_at);

CREATE TABLE IF NOT EXISTS api_rate_limits(
  key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(key,window_start)
);
CREATE INDEX IF NOT EXISTS api_rate_limits_window ON api_rate_limits(window_start);

CREATE TABLE IF NOT EXISTS credit_meta(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Cross-request stop signal for streaming Agent runs. This deliberately lives
-- outside the workspace row lock so /interrupt cannot block behind the run.
CREATE TABLE IF NOT EXISTS agent_run_cancels(
  run_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  symbol TEXT,
  period TEXT,
  session_id TEXT,
  question TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE agent_run_cancels ADD COLUMN IF NOT EXISTS symbol TEXT;
ALTER TABLE agent_run_cancels ADD COLUMN IF NOT EXISTS period TEXT;
ALTER TABLE agent_run_cancels ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE agent_run_cancels ADD COLUMN IF NOT EXISTS question TEXT;
CREATE INDEX IF NOT EXISTS agent_run_cancels_created ON agent_run_cancels(created_at);

CREATE TABLE IF NOT EXISTS credit_accounts(
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  invite_code TEXT NOT NULL UNIQUE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK(balance>=0),
  new_user BOOLEAN NOT NULL DEFAULT false,
  inviter_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  CHECK(inviter_id<>user_id)
);

CREATE TABLE IF NOT EXISTS credit_ledger(
  event_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_usage(
  -- token metering; credits is the final charged amount for this request

  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  request_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('reserved','consumed','released')),
  source TEXT NOT NULL CHECK(source IN ('permanent','subscription')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id,request_key)
);

-- One timestamp is written when this migration first runs. Accounts created
-- after it are eligible for the one-time welcome grant even if the Better Auth
-- user-creation hook failed before it could register the credit account.
INSERT INTO credit_meta(key,value)
VALUES('migrated_at', (extract(epoch from now())*1000)::bigint::text)
ON CONFLICT(key) DO NOTHING;

ALTER TABLE billing_orders DROP CONSTRAINT IF EXISTS billing_orders_plan_check;
ALTER TABLE billing_orders DROP CONSTRAINT IF EXISTS billing_orders_period_check;
ALTER TABLE billing_orders ADD COLUMN IF NOT EXISTS credits INTEGER CHECK(credits>0);
ALTER TABLE billing_orders DROP CONSTRAINT IF EXISTS billing_orders_product_check;
ALTER TABLE billing_orders ADD CONSTRAINT billing_orders_product_check
  CHECK((credits IS NULL AND plan IN ('pro','research') AND period IN ('monthly','annual'))
     OR (credits IS NOT NULL AND period='permanent'));

-- Give existing accounts a stable public number in registration order.
INSERT INTO user_identity(user_id,public_id,ordinal,created_at)
SELECT u.id,
       'WY-' || lpad((row_number() OVER (ORDER BY u."createdAt", u.id))::text, 6, '0'),
       row_number() OVER (ORDER BY u."createdAt", u.id),
       u."createdAt"
FROM "user" u
WHERE NOT EXISTS (SELECT 1 FROM user_identity i WHERE i.user_id=u.id)
ON CONFLICT DO NOTHING;

-- Existing accounts that already received the old 3-credit welcome grant are
-- topped up to 10 total. New early-bird accounts receive 10 directly.
WITH inserted AS (
  INSERT INTO credit_ledger(event_key,user_id,amount)
  SELECT 'earlybird:' || i.user_id, i.user_id, 7
  FROM user_identity i
  JOIN credit_ledger w ON w.event_key = 'welcome:' || i.user_id AND w.amount = 3
  WHERE i.ordinal <= 100
  ON CONFLICT(event_key) DO NOTHING
  RETURNING user_id
)
UPDATE credit_accounts c
SET balance = balance + 7
WHERE c.user_id IN (SELECT user_id FROM inserted);

-- Accounts created before the credit ledger existed have no welcome row.
-- Give verified early users the same 10-credit early-bird welcome once.
WITH inserted AS (
  INSERT INTO credit_ledger(event_key,user_id,amount)
  SELECT 'earlybird:welcome:' || i.user_id, i.user_id, 10
  FROM user_identity i
  JOIN "user" u ON u.id = i.user_id AND u."emailVerified" = true
  WHERE i.ordinal <= 100
    AND NOT EXISTS (SELECT 1 FROM credit_ledger w WHERE w.event_key = 'welcome:' || i.user_id)
    AND NOT EXISTS (SELECT 1 FROM credit_ledger w WHERE w.event_key = 'earlybird:welcome:' || i.user_id)
  ON CONFLICT(event_key) DO NOTHING
  RETURNING user_id
)
UPDATE credit_accounts c
SET balance = balance + 10
WHERE c.user_id IN (SELECT user_id FROM inserted);

ALTER TABLE credit_usage ADD COLUMN IF NOT EXISTS input_tokens INTEGER;
ALTER TABLE credit_usage ADD COLUMN IF NOT EXISTS output_tokens INTEGER;
ALTER TABLE credit_usage ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 1;

ALTER TABLE user_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_referral_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON user_identity,auth_referral_intents,api_rate_limits,credit_meta,credit_accounts,credit_ledger,credit_usage FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON auth_referral_intents,api_rate_limits,credit_meta,credit_accounts,credit_ledger,credit_usage FROM %I',r);
    END IF;
  END LOOP;
END $$;
`);
}
