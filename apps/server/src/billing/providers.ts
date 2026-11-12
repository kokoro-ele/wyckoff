import { createHmac, timingSafeEqual } from "node:crypto";
import { BillingError } from "./catalog.js";
import type { Provider } from "./catalog.js";

type Env = NodeJS.ProcessEnv;

/** Stripe is the only payment provider; local HTTP is allowed for dev tunnels. */
export function availability(env: Env = process.env) {
  const origin = env.BILLING_PUBLIC_ORIGIN ?? "";
  const localHost = /^http:\/\/localhost(?::\d+)?$/.test(origin) && env.NODE_ENV !== "production";
  const base = /^https:\/\/[^/]+$/.test(origin) || localHost;
  return {
    stripe: {
      available: base && !!env.STRIPE_SECRET_KEY && !!env.STRIPE_WEBHOOK_SECRET,
    },
  };
}

export function verifyStripe(
  body: string,
  header: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): Record<string, any> {
  const parts = header.split(",").map((part) => part.split("="));
  const timestamps = parts.filter(([key]) => key === "t");
  const timestamp = timestamps[0]?.[1];
  if (
    timestamps.length !== 1 ||
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > 300
  ) {
    throw new BillingError("INVALID_SIGNATURE", "Invalid signature", 401);
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  const valid = parts
    .filter(([key]) => key === "v1")
    .some(
      ([, signature]) =>
        !!signature &&
        /^[a-f0-9]{64}$/i.test(signature) &&
        timingSafeEqual(expected, Buffer.from(signature, "hex")),
    );
  if (!valid) throw new BillingError("INVALID_SIGNATURE", "Invalid signature", 401);
  return JSON.parse(body);
}

export interface CheckoutOrder {
  id: string;
  provider: Provider;
  plan: string;
  period: string;
  amount: number;
  currency: string;
  expires_at: Date;
}

export async function createProviderCheckout(order: CheckoutOrder, env: Env = process.env) {
  if (order.provider !== "stripe" || !availability(env).stripe.available) {
    throw new BillingError("PROVIDER_UNAVAILABLE", "Stripe is not activated", 503);
  }
  const origin = env.BILLING_PUBLIC_ORIGIN!;
  const body = new URLSearchParams({
    mode: "payment",
    success_url: `${origin}/app?billing=success&order=${order.id}`,
    cancel_url: `${origin}/app?billing=cancel`,
    client_reference_id: order.id,
    "metadata[order_id]": order.id,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": order.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(order.amount),
    "line_items[0][price_data][product_data][name]": `Wyckoff ${order.plan} ${order.period} prepaid`,
    expires_at: String(Math.floor(order.expires_at.getTime() / 1000)),
  });
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": order.id,
      "Stripe-Version": "2025-02-24.acacia",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new BillingError("PROVIDER_UNAVAILABLE", "Stripe could not create checkout", 503);
  }
  const data = (await response.json()) as { id: string; url: string };
  if (!data.id || !data.url || new URL(data.url).hostname !== "checkout.stripe.com") {
    throw new BillingError("INVALID_PROVIDER_RESPONSE", "Invalid checkout response", 503);
  }
  return { providerId: data.id, checkoutUrl: data.url };
}
