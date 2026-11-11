import type { Pool } from "pg";
import { billingErrorResponse, BillingError } from "./catalog.js";
import { availability, verifyStripe } from "./providers.js";
import { fulfillPayment } from "./store.js";

export { BillingError, billingErrorResponse } from "./catalog.js";

/**
 * Payment webhooks only. The new product sells permanent credit packs through
 * `/api/credits/*`; legacy subscription orders are still fulfilled here so
 * already-paid historical orders keep working.
 *
 * Mount BEFORE session authentication. This handler authenticates the raw body.
 */
export async function handleBillingWebhook(request: Request, pool: Pool): Promise<Response> {
  try {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    if (!availability().stripe.available) {
      throw new BillingError("PROVIDER_UNAVAILABLE", "Stripe merchant is not activated", 503);
    }
    const body = await request.text();
    if (Buffer.byteLength(body) > 262144) throw new BillingError("INVALID_EVENT", "Event too large");

    const event = verifyStripe(
      body,
      request.headers.get("stripe-signature") ?? "",
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
    if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
      return Response.json({ received: true });
    }
    const session = event.data?.object;
    if (session?.payment_status !== "paid") return Response.json({ received: true });
    const live =
      process.env.STRIPE_SECRET_KEY!.startsWith("sk_live_") ||
      process.env.STRIPE_SECRET_KEY!.startsWith("rk_live_");
    if (
      event.account ||
      event.livemode !== live ||
      session.mode !== "payment" ||
      !session.id ||
      typeof session.payment_intent !== "string" ||
      session.metadata?.order_id !== session.client_reference_id ||
      !Number.isInteger(event.created)
    ) {
      throw new BillingError("INVALID_EVENT", "Payment event does not match merchant mode or order");
    }
    await fulfillPayment(pool, {
      provider: "stripe",
      eventId: event.id,
      transactionId: session.payment_intent,
      providerId: session.id,
      orderId: session.client_reference_id,
      amount: session.amount_total,
      currency: String(session.currency).toUpperCase(),
      paidAt: new Date(event.created * 1000),
    });
    return Response.json({ received: true });
  } catch (error) {
    const result = billingErrorResponse(error);
    return Response.json(result.body, { status: result.status });
  }
}
