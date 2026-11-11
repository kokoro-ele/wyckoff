import type { Pool } from "pg";

/**
 * Creates the permanent-analysis-credit ledger.
 *
 * Existing installations keep their historical rows. New tables use cascading
 * FKs so account deletion cannot get stuck on old credit or referral records.
 */
export async function migrateCredits(pool: Pool) {
  await pool.query(`
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

ALTER TABLE auth_referral_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON auth_referral_intents,api_rate_limits,credit_meta,credit_accounts,credit_ledger,credit_usage FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON auth_referral_intents,api_rate_limits,credit_meta,credit_accounts,credit_ledger,credit_usage FROM %I',r);
    END IF;
  END LOOP;
END $$;
`);
}
