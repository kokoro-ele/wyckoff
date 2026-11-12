import type { Pool } from 'pg';
/** Run with the owner/migration role; API users receive no table policies or grants. */
export async function migrateBilling(pool:Pool) {
  await pool.query(`
-- Historical WeChat rows remain readable; new checkouts are Stripe-only.
CREATE TABLE IF NOT EXISTS billing_orders (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 idempotency_key TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider IN ('stripe','wechat')),
 plan TEXT NOT NULL CHECK(plan IN ('pro','research')), period TEXT NOT NULL CHECK(period IN ('monthly','annual')),
 amount INTEGER NOT NULL CHECK(amount>0), currency TEXT NOT NULL CHECK(currency IN ('CNY','USD')),
 status TEXT NOT NULL CHECK(status IN ('creating','pending','failed','expired','paid')),
 provider_id TEXT, checkout_url TEXT, code_url TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL, paid_at TIMESTAMPTZ, UNIQUE(user_id,idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_one_pending ON billing_orders(user_id) WHERE status IN ('creating','pending');
CREATE UNIQUE INDEX IF NOT EXISTS billing_provider_order ON billing_orders(provider,provider_id) WHERE provider_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS billing_subscriptions (
 user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
 plan TEXT NOT NULL CHECK(plan IN ('pro','research')), expires_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS billing_events (
 provider TEXT NOT NULL, event_id TEXT NOT NULL, order_id TEXT NOT NULL REFERENCES billing_orders(id),
 transaction_id TEXT NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(provider,event_id), UNIQUE(provider,transaction_id)
);
CREATE TABLE IF NOT EXISTS billing_usage (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('analysis','backtest','recommendation')),
 request_key TEXT NOT NULL, month DATE NOT NULL, state TEXT NOT NULL CHECK(state IN ('reserved','consumed','released')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL, UNIQUE(user_id,kind,request_key)
);
CREATE INDEX IF NOT EXISTS billing_usage_month ON billing_usage(user_id,month,state);

CREATE TABLE IF NOT EXISTS access_entitlements (
 user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 product TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('subscription','lifetime','admin')),
 status TEXT NOT NULL CHECK(status IN ('active','canceled','expired')),
 current_period_end TIMESTAMPTZ,
 stripe_subscription_id TEXT,
 stripe_customer_id TEXT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,product)
);
CREATE INDEX IF NOT EXISTS access_subscription ON access_entitlements(stripe_subscription_id);
CREATE TABLE IF NOT EXISTS subscription_orders (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 idempotency_key TEXT NOT NULL,
 product TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('subscription','payment')),
 amount INTEGER NOT NULL CHECK(amount>0),
 currency TEXT NOT NULL CHECK(currency IN ('USD','CNY')),
 status TEXT NOT NULL CHECK(status IN ('creating','pending','failed','expired','paid')),
 stripe_session_id TEXT,
 stripe_subscription_id TEXT,
 checkout_url TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL,
 paid_at TIMESTAMPTZ,
 UNIQUE(user_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS subscription_pending ON subscription_orders(user_id) WHERE status IN ('creating','pending');
CREATE TABLE IF NOT EXISTS subscription_events (
 provider TEXT NOT NULL,
 event_id TEXT NOT NULL,
 order_id TEXT NOT NULL REFERENCES subscription_orders(id),
 transaction_id TEXT NOT NULL,
 received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(provider,event_id),
 UNIQUE(provider,transaction_id)
);
ALTER TABLE access_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON access_entitlements,subscription_orders,subscription_events FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON access_entitlements,subscription_orders,subscription_events FROM %I',r);
  END IF;
 END LOOP;
END $$;

ALTER TABLE billing_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON billing_orders,billing_subscriptions,billing_events,billing_usage FROM PUBLIC;
DO $$ DECLARE r TEXT; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON billing_orders,billing_subscriptions,billing_events,billing_usage FROM %I',r);
  END IF;
 END LOOP;
END $$;
`);
}
