import type { Pool, PoolClient } from "pg";

type DB = Pool | PoolClient;

export interface Entitlement {
  user_id: string;
  product: string;
  source: "subscription" | "lifetime" | "admin";
  status: "active" | "canceled" | "expired";
  current_period_end: Date | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
}

export async function getEntitlement(pool: DB, userId: string, product = "byok"): Promise<Entitlement | null> {
  const row = (
    await pool.query<Entitlement>(
      "SELECT * FROM access_entitlements WHERE user_id=$1 AND product=$2",
      [userId, product],
    )
  ).rows[0];
  return row ?? null;
}

export async function hasEntitlement(pool: DB, userId: string, product = "byok"): Promise<boolean> {
  const entitlement = await getEntitlement(pool, userId, product);
  return Boolean(
    entitlement &&
      entitlement.status === "active" &&
      (entitlement.current_period_end === null || entitlement.current_period_end > new Date()),
  );
}

export async function grantEntitlement(
  pool: DB,
  userId: string,
  input: {
    product?: string;
    source: "subscription" | "lifetime" | "admin";
    currentPeriodEnd: Date | null;
    stripeSubscriptionId?: string | null;
    stripeCustomerId?: string | null;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO access_entitlements(user_id,product,source,status,current_period_end,stripe_subscription_id,stripe_customer_id,updated_at)
     VALUES($1,$2,$3,'active',$4,$5,$6,now())
     ON CONFLICT(user_id,product) DO UPDATE SET
       source=EXCLUDED.source,
       status='active',
       current_period_end=EXCLUDED.current_period_end,
       stripe_subscription_id=COALESCE(EXCLUDED.stripe_subscription_id,access_entitlements.stripe_subscription_id),
       stripe_customer_id=COALESCE(EXCLUDED.stripe_customer_id,access_entitlements.stripe_customer_id),
       updated_at=now()`,
    [
      userId,
      input.product ?? "byok",
      input.source,
      input.currentPeriodEnd,
      input.stripeSubscriptionId ?? null,
      input.stripeCustomerId ?? null,
    ],
  );
}

export async function syncSubscriptionEntitlement(
  pool: DB,
  stripeSubscriptionId: string,
  input: {
    status: string;
    currentPeriodEnd: Date | null;
    stripeCustomerId?: string | null;
  },
): Promise<void> {
  const active = ["active", "trialing", "past_due"].includes(input.status);
  await pool.query(
    `UPDATE access_entitlements SET
       status=$2,
       current_period_end=$3,
       stripe_customer_id=COALESCE($4,stripe_customer_id),
       updated_at=now()
     WHERE stripe_subscription_id=$1 AND product='byok'`,
    [stripeSubscriptionId, active ? "active" : "expired", input.currentPeriodEnd, input.stripeCustomerId ?? null],
  );
}

export async function revokeEntitlement(pool: DB, userId: string, product = "byok"): Promise<void> {
  await pool.query(
    "UPDATE access_entitlements SET status='expired',updated_at=now() WHERE user_id=$1 AND product=$2",
    [userId, product],
  );
}
