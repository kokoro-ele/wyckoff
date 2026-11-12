import type { Pool } from "pg";
import { BillingError } from "./catalog.js";
import { findSubscriptionProduct } from "./subscriptionCatalog.js";
import { grantEntitlement, syncSubscriptionEntitlement } from "./entitlements.js";
import { findSubscriptionOrder } from "./subscriptionStore.js";

interface StripeSubscription {
  id: string;
  status: string;
  current_period_end?: number;
  customer?: string | { id?: string };
}

async function stripeSubscription(id: string): Promise<StripeSubscription | null> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return null;
  const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${secret}`, "Stripe-Version": "2025-02-24.acacia" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new BillingError("PROVIDER_UNAVAILABLE", "Could not read Stripe subscription", 503);
  return (await response.json()) as StripeSubscription;
}

function customerId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

export async function fulfillSubscriptionCheckout(pool: Pool, session: any, event: any): Promise<boolean> {
  const orderId = typeof session?.client_reference_id === "string" ? session.client_reference_id : "";
  if (!orderId) return false;
  const order = await findSubscriptionOrder(pool, orderId);
  if (!order) return false;
  if (session.mode !== order.mode) throw new BillingError("INVALID_EVENT", "Checkout mode mismatch");
  if (session.payment_status !== "paid") return true;
  if (
    session.amount_total !== order.amount ||
    String(session.currency).toUpperCase() !== order.currency
  ) {
    throw new BillingError("PAYMENT_MISMATCH", "Payment does not match subscription order");
  }
  const product = findSubscriptionProduct(order.product);
  if (!product) throw new BillingError("UNKNOWN_ORDER", "Unknown subscription product");

  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : order.stripe_subscription_id;
  const transactionId =
    subscriptionId ||
    (typeof session.payment_intent === "string" ? session.payment_intent : session.id);
  const inserted = await pool.query(
    "INSERT INTO subscription_events(provider,event_id,order_id,transaction_id) VALUES('stripe',$1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_id",
    [event.id, order.id, transactionId],
  );
  if (!inserted.rowCount || order.status === "paid") return true;

  await pool.query(
    "UPDATE subscription_orders SET status='paid',paid_at=$2,stripe_session_id=COALESCE($3,stripe_session_id),stripe_subscription_id=COALESCE($4,stripe_subscription_id) WHERE id=$1",
    [order.id, new Date(event.created * 1000), session.id ?? null, subscriptionId ?? null],
  );

  if (product.mode === "payment") {
    await grantEntitlement(pool, order.user_id, {
      product: product.entitlement,
      source: "lifetime",
      currentPeriodEnd: null,
      stripeCustomerId: customerId(session.customer),
    });
    return true;
  }

  if (!subscriptionId) throw new BillingError("INVALID_EVENT", "Subscription id missing");
  const sub = await stripeSubscription(subscriptionId);
  if (!sub) throw new BillingError("PROVIDER_UNAVAILABLE", "Stripe subscription unavailable");
  await grantEntitlement(pool, order.user_id, {
    product: product.entitlement,
    source: "subscription",
    currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
    stripeSubscriptionId: subscriptionId,
    stripeCustomerId: customerId(sub.customer) ?? customerId(session.customer),
  });
  return true;
}

export async function handleSubscriptionEvent(pool: Pool, event: any): Promise<boolean> {
  if (!["customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed"].includes(event.type)) {
    return false;
  }
  const object = event.data?.object ?? {};
  let subscription: StripeSubscription | null = null;
  let subscriptionId = "";

  if (event.type.startsWith("customer.subscription.")) {
    subscriptionId = object.id;
    subscription = {
      id: object.id,
      status: object.status,
      current_period_end: object.current_period_end ?? object.items?.data?.[0]?.current_period_end,
      customer: object.customer,
    };
  } else {
    subscriptionId = typeof object.subscription === "string" ? object.subscription : "";
    if (!subscriptionId) return true;
    subscription = await stripeSubscription(subscriptionId);
  }
  if (!subscriptionId || !subscription) return true;

  const deleted = event.type === "customer.subscription.deleted";
  await syncSubscriptionEntitlement(pool, subscriptionId, {
    status: deleted ? "canceled" : subscription.status,
    currentPeriodEnd: deleted
      ? new Date()
      : subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : null,
    stripeCustomerId: customerId(subscription.customer),
  });
  return true;
}
