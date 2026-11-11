import { creditPacks } from "../credits/catalog.js";
import { addCredits } from "../credits/store.js";
import { consumeRateLimit } from "../credits/rateLimit.js";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { BillingError, addPeriod } from "./catalog.js";
import type { PaidPlan, Period, Provider } from "./catalog.js";
import { availability, createProviderCheckout } from "./providers.js";
import type { CheckoutOrder } from "./providers.js";

export async function withAccountLock<T>(
  pool: Pool,
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`billing:${userId}`]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

interface StoredOrder extends CheckoutOrder {
  credits?: number | null;
  user_id: string;
  status: string;
  provider_id: string | null;
  checkout_url: string | null;
}

function publicOrder(order: StoredOrder) {
  return {
    orderId: order.id,
    provider: order.provider,
    status: order.status,
    checkoutUrl: order.checkout_url ?? undefined,
    expiresAt: order.expires_at.toISOString(),
  };
}

export interface VerifiedPayment {
  provider: Provider;
  eventId: string;
  transactionId: string;
  orderId: string;
  providerId: string;
  amount: number;
  currency: string;
  paidAt: Date;
}

/**
 * Fulfils a signed provider event exactly once.
 *
 * Credit-pack orders add their snapshotted permanent credits. Legacy prepaid
 * subscription orders extend the existing subscription without ever
 * downgrading an active Research plan.
 */
export async function fulfillPayment(pool: Pool, payment: VerifiedPayment) {
  if (
    !payment.eventId ||
    !payment.transactionId ||
    !payment.orderId ||
    !Number.isSafeInteger(payment.amount) ||
    !Number.isFinite(payment.paidAt.getTime())
  ) {
    throw new BillingError("INVALID_PAYMENT", "Invalid payment");
  }
  const order = (await pool.query<StoredOrder>("SELECT * FROM billing_orders WHERE id=$1", [payment.orderId]))
    .rows[0];
  if (!order) throw new BillingError("UNKNOWN_ORDER", "Unknown order");

  await withAccountLock(pool, order.user_id, async (db) => {
    const current = (
      await db.query<StoredOrder>("SELECT * FROM billing_orders WHERE id=$1 FOR UPDATE", [order.id])
    ).rows[0];
    if (
      current.provider !== payment.provider ||
      current.amount !== payment.amount ||
      current.currency !== payment.currency ||
      (current.provider_id && current.provider_id !== payment.providerId)
    ) {
      throw new BillingError("PAYMENT_MISMATCH", "Payment does not match order");
    }

    // A legitimate delayed webhook is accepted regardless of local pending expiration.
    const inserted = await db.query(
      "INSERT INTO billing_events(provider,event_id,order_id,transaction_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING event_id",
      [payment.provider, payment.eventId, order.id, payment.transactionId],
    );
    if (!inserted.rowCount || current.status === "paid") return;

    if (current.credits) {
      await addCredits(db, order.user_id, current.credits, `payment:${order.id}`);
      await db.query("UPDATE billing_orders SET status='paid',paid_at=$2,provider_id=$3 WHERE id=$1", [
        order.id,
        payment.paidAt,
        payment.providerId,
      ]);
      return;
    }

    const existing = (
      await db.query<{ plan: PaidPlan; expires_at: Date }>(
        "SELECT plan,expires_at FROM billing_subscriptions WHERE user_id=$1",
        [order.user_id],
      )
    ).rows[0];
    const now = new Date();
    const active = existing && existing.expires_at > now;
    // Rare out-of-order payments never downgrade an active Research subscription.
    const plan = active && existing.plan === "research" ? "research" : current.plan;
    const end = addPeriod(active ? existing.expires_at : now, current.period as Period);
    await db.query(
      `INSERT INTO billing_subscriptions(user_id,plan,expires_at) VALUES($1,$2,$3)
       ON CONFLICT(user_id) DO UPDATE SET plan=EXCLUDED.plan,expires_at=EXCLUDED.expires_at,updated_at=now()`,
      [order.user_id, plan, end],
    );
    await db.query("UPDATE billing_orders SET status='paid',paid_at=$2,provider_id=$3 WHERE id=$1", [
      order.id,
      payment.paidAt,
      payment.providerId,
    ]);
  });
}

export async function getOrder(pool: Pool, userId: string, id: string) {
  const row = (
    await pool.query<StoredOrder>("SELECT * FROM billing_orders WHERE user_id=$1 AND id=$2", [userId, id])
  ).rows.at(0);
  if (!row) throw new BillingError("ORDER_NOT_FOUND", "Order not found");
  if (["creating", "pending"].includes(row.status) && row.expires_at <= new Date()) row.status = "expired";
  return publicOrder(row);
}

export async function currentOrder(pool: Pool, userId: string) {
  const row = (
    await pool.query<StoredOrder>(
      "SELECT * FROM billing_orders WHERE user_id=$1 AND status IN ('creating','pending') AND expires_at>now() ORDER BY created_at DESC LIMIT 1",
      [userId],
    )
  ).rows.at(0);
  return row ? publicOrder(row) : null;
}

/** Creates a checkout for an operator-configured permanent credit pack. */
export async function checkoutCreditPack(
  pool: Pool,
  userId: string,
  input: { packId: string; provider: string },
  key: string,
) {
  if (!(await consumeRateLimit(pool, `checkout:${userId}`, 10, 10 * 60_000))) {
    throw new BillingError("RATE_LIMITED", "操作过于频繁，请稍后再试", 429);
  }
  const pack = creditPacks().find((p) => p.id === input.packId);
  if (!pack || input.provider !== "stripe") {
    throw new BillingError("INVALID_CHECKOUT", "充值次数包或支付方式不可用");
  }
  const provider: Provider = "stripe";
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) {
    throw new BillingError("INVALID_IDEMPOTENCY_KEY", "Provide an Idempotency-Key");
  }
  if (!availability()[provider].available) {
    throw new BillingError("PROVIDER_UNAVAILABLE", "Payment merchant is not activated", 503);
  }

  const result = await withAccountLock(pool, userId, async (db) => {
    const prior = (
      await db.query<StoredOrder>("SELECT * FROM billing_orders WHERE user_id=$1 AND idempotency_key=$2", [
        userId,
        key,
      ])
    ).rows[0];
    if (prior) {
      if (prior.plan !== pack.id || prior.period !== "permanent" || prior.provider !== provider) {
        throw new BillingError("IDEMPOTENCY_CONFLICT", "Key already used", 409);
      }
      if (prior.status === "creating") {
        if (prior.expires_at > new Date()) {
          throw new BillingError("CHECKOUT_IN_PROGRESS", "Checkout is being created; retry shortly", 409);
        }
        // A crashed process can leave a `creating` row forever. Mark it failed
        // so the UI can rotate to a fresh idempotency key.
        await db.query("UPDATE billing_orders SET status='failed' WHERE id=$1 AND status='creating'", [
          prior.id,
        ]);
        throw new BillingError(
          "CHECKOUT_FAILED",
          "Previous attempt expired; start a new checkout with a new Idempotency-Key",
          409,
        );
      }
      if (prior.status === "failed") {
        throw new BillingError(
          "CHECKOUT_FAILED",
          "Previous attempt failed; start a new checkout with a new Idempotency-Key",
          409,
        );
      }
      return { order: prior, create: false };
    }

    await db.query(
      "UPDATE billing_orders SET status='expired' WHERE user_id=$1 AND status IN ('creating','pending') AND expires_at<=now()",
      [userId],
    );
    if (
      (
        await db.query("SELECT id FROM billing_orders WHERE user_id=$1 AND status IN ('creating','pending')", [
          userId,
        ])
      ).rowCount
    ) {
      throw new BillingError("PENDING_CHECKOUT", "已有待支付订单，请稍后重试", 409);
    }

    const order = (
      await db.query<StoredOrder>(
        `INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period,credits,amount,currency,status,expires_at)
         VALUES($1,$2,$3,$4,$5,'permanent',$6,$7,$8,'creating',$9) RETURNING *`,
        [
          randomUUID().replaceAll("-", ""),
          userId,
          key,
          provider,
          pack.id,
          pack.credits,
          pack.amount,
          pack.currency,
          new Date(Date.now() + 35 * 60_000),
        ],
      )
    ).rows[0];
    return { order, create: true };
  });

  if (!result.create) return publicOrder(result.order);
  try {
    const remote = await createProviderCheckout(result.order);
    const updated = await pool.query<StoredOrder>(
      `UPDATE billing_orders SET provider_id=$2,checkout_url=$3,
       status=CASE WHEN status='paid' THEN 'paid' ELSE 'pending' END WHERE id=$1 RETURNING *`,
      [result.order.id, remote.providerId, remote.checkoutUrl],
    );
    return publicOrder(updated.rows[0]);
  } catch (error) {
    await pool.query("UPDATE billing_orders SET status='failed' WHERE id=$1 AND status='creating'", [
      result.order.id,
    ]);
    throw error;
  }
}
