import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { BillingError } from "./catalog.js";
import { availability } from "./providers.js";
import { withAccountLock } from "./store.js";
import { consumeRateLimit } from "../credits/rateLimit.js";
import { findSubscriptionProduct, priceIdFor, type SubscriptionProduct } from "./subscriptionCatalog.js";

interface SubscriptionOrder {
  id: string;
  user_id: string;
  idempotency_key: string;
  product: string;
  mode: "subscription" | "payment";
  amount: number;
  currency: string;
  status: string;
  stripe_session_id: string | null;
  stripe_subscription_id: string | null;
  checkout_url: string | null;
  created_at: Date;
  expires_at: Date;
  paid_at: Date | null;
}

export function publicSubscriptionOrder(order: SubscriptionOrder) {
  return {
    orderId: order.id,
    product: order.product,
    mode: order.mode,
    status: order.status,
    checkoutUrl: order.checkout_url ?? undefined,
    expiresAt: order.expires_at.toISOString(),
  };
}

export function stripeOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const origin = env.BILLING_PUBLIC_ORIGIN ?? "";
  const local = /^http:\/\/localhost(?::\d+)?$/.test(origin) && env.NODE_ENV !== "production";
  return /^https:\/\/[^/]+$/.test(origin) || local ? origin : null;
}

async function createCheckout(order: SubscriptionOrder, product: SubscriptionProduct): Promise<{ id: string; url: string }> {
  const origin = stripeOrigin();
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!origin || !secret) throw new BillingError("PROVIDER_UNAVAILABLE", "Stripe is not activated", 503);
  const priceId = priceIdFor(product);
  if (product.mode === "subscription" && !priceId) {
    throw new BillingError("PROVIDER_UNAVAILABLE", "Stripe subscription price is not configured", 503);
  }
  const body = new URLSearchParams({
    mode: product.mode,
    success_url: `${origin}/app?settings=1&subscription=${order.id}`,
    cancel_url: `${origin}/app?settings=1`,
    client_reference_id: order.id,
    "metadata[order_id]": order.id,
    "metadata[product]": product.id,
    "line_items[0][quantity]": "1",
    "payment_method_types[0]": "card",
    expires_at: String(Math.floor(order.expires_at.getTime() / 1000)),
  });
  if (product.mode === "subscription") {
    body.set("line_items[0][price]", priceId!);
    body.set("subscription_data[metadata][order_id]", order.id);
    body.set("subscription_data[metadata][product]", product.id);
  } else {
    body.set("line_items[0][price_data][currency]", order.currency.toLowerCase());
    body.set("line_items[0][price_data][unit_amount]", String(order.amount));
    body.set("line_items[0][price_data][product_data][name]", product.name);
  }
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": order.id,
      "Stripe-Version": "2025-02-24.acacia",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    console.error("[billing] subscription checkout failed", response.status);
    throw new BillingError("PROVIDER_UNAVAILABLE", "Stripe could not create checkout", 503);
  }
  const session = (await response.json()) as { id?: string; url?: string };
  if (!session.id || !session.url) throw new BillingError("PROVIDER_UNAVAILABLE", "Stripe returned no checkout URL", 503);
  return { id: session.id, url: session.url };
}

export async function checkoutSubscription(
  pool: Pool,
  userId: string,
  productId: string,
  key: string,
) {
  if (!(await consumeRateLimit(pool, `subscription-checkout:${userId}`, 10, 10 * 60_000))) {
    throw new BillingError("RATE_LIMITED", "操作过于频繁，请稍后再试", 429);
  }
  const product = findSubscriptionProduct(productId);
  if (!product) throw new BillingError("INVALID_CHECKOUT", "订阅产品不存在");
  if (!availability().stripe.available) {
    throw new BillingError("PROVIDER_UNAVAILABLE", "Payment merchant is not activated", 503);
  }
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) {
    throw new BillingError("INVALID_IDEMPOTENCY_KEY", "Provide an Idempotency-Key");
  }

  const result = await withAccountLock(pool, userId, async (db) => {
    const prior = (
      await db.query<SubscriptionOrder>(
        "SELECT * FROM subscription_orders WHERE user_id=$1 AND idempotency_key=$2",
        [userId, key],
      )
    ).rows[0];
    if (prior) {
      if (prior.product !== product.id) throw new BillingError("IDEMPOTENCY_CONFLICT", "Key already used", 409);
      if (prior.status === "failed") throw new BillingError("CHECKOUT_FAILED", "Previous checkout failed", 409);
      return { order: prior, create: false };
    }
    await db.query(
      "UPDATE subscription_orders SET status='expired' WHERE user_id=$1 AND status IN ('creating','pending') AND expires_at<=now()",
      [userId],
    );
    if (
      (await db.query("SELECT id FROM subscription_orders WHERE user_id=$1 AND status IN ('creating','pending')", [userId]))
        .rowCount
    ) {
      throw new BillingError("PENDING_CHECKOUT", "已有待支付订单，请稍后重试", 409);
    }
    const order = (
      await db.query<SubscriptionOrder>(
        `INSERT INTO subscription_orders(id,user_id,idempotency_key,product,mode,amount,currency,status,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,'creating',$8) RETURNING *`,
        [
          randomUUID().replaceAll("-", ""),
          userId,
          key,
          product.id,
          product.mode,
          product.amount,
          product.currency,
          new Date(Date.now() + 35 * 60_000),
        ],
      )
    ).rows[0];
    return { order, create: true };
  });

  if (!result.create) return publicSubscriptionOrder(result.order);
  try {
    const remote = await createCheckout(result.order, product);
    const updated = await pool.query<SubscriptionOrder>(
      `UPDATE subscription_orders SET stripe_session_id=$2,checkout_url=$3,status='pending' WHERE id=$1 RETURNING *`,
      [result.order.id, remote.id, remote.url],
    );
    return publicSubscriptionOrder(updated.rows[0]);
  } catch (error) {
    await pool.query("UPDATE subscription_orders SET status='failed' WHERE id=$1 AND status='creating'", [result.order.id]);
    throw error;
  }
}

export async function currentSubscriptionOrder(pool: Pool, userId: string) {
  const row = (
    await pool.query<SubscriptionOrder>(
      "SELECT * FROM subscription_orders WHERE user_id=$1 AND status IN ('creating','pending') AND expires_at>now() ORDER BY created_at DESC LIMIT 1",
      [userId],
    )
  ).rows[0];
  return row ? publicSubscriptionOrder(row) : null;
}

export async function getSubscriptionOrder(pool: Pool, userId: string, id: string) {
  const row = (
    await pool.query<SubscriptionOrder>("SELECT * FROM subscription_orders WHERE user_id=$1 AND id=$2", [userId, id])
  ).rows[0];
  if (!row) throw new BillingError("ORDER_NOT_FOUND", "Order not found");
  return publicSubscriptionOrder(row);
}

export async function findSubscriptionOrder(pool: Pool, id: string) {
  return (await pool.query<SubscriptionOrder>("SELECT * FROM subscription_orders WHERE id=$1", [id])).rows[0] ?? null;
}


export async function createBillingPortal(pool: Pool, userId: string): Promise<string> {
  const origin = stripeOrigin();
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!origin || !secret) throw new BillingError("PROVIDER_UNAVAILABLE", "Stripe is not activated", 503);
  const row = (
    await pool.query<{ stripe_customer_id: string | null }>(
      "SELECT stripe_customer_id FROM access_entitlements WHERE user_id=$1 AND product='byok' AND status='active'",
      [userId],
    )
  ).rows[0];
  if (!row?.stripe_customer_id) throw new BillingError("PORTAL_UNAVAILABLE", "没有可管理的 Stripe 订阅");
  const body = new URLSearchParams({
    customer: row.stripe_customer_id,
    return_url: `${origin}/app?settings=1`,
  });
  const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2025-02-24.acacia",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new BillingError("PROVIDER_UNAVAILABLE", "Stripe could not open the billing portal", 503);
  const session = (await response.json()) as { url?: string };
  if (!session.url) throw new BillingError("PROVIDER_UNAVAILABLE", "Stripe returned no portal URL", 503);
  return session.url;
}
