import type { Pool } from "pg";
import { billingErrorResponse, BillingError } from "./catalog.js";
import type { Provider } from "./catalog.js";
import { availability, verifyStripe, verifyWechat } from "./providers.js";
import { fulfillPayment } from "./store.js";

export { BillingError, billingErrorResponse } from "./catalog.js";

/**
 * Payment webhooks only. The new product sells permanent credit packs through
 * `/api/credits/*`; legacy subscription orders are still fulfilled here so
 * already-paid historical orders keep working.
 *
 * Mount BEFORE session authentication. This handler authenticates the raw body.
 */
export async function handleBillingWebhook(
  request: Request,
  provider: Provider,
  pool: Pool,
): Promise<Response> {
  try {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    if (!availability()[provider].available) {
      throw new BillingError("PROVIDER_UNAVAILABLE", "Payment merchant is not activated", 503);
    }
    const body = await request.text();
    if (Buffer.byteLength(body) > 262144) throw new BillingError("INVALID_EVENT", "Event too large");

    if (provider === "stripe") {
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
        provider,
        eventId: event.id,
        transactionId: session.payment_intent,
        providerId: session.id,
        orderId: session.client_reference_id,
        amount: session.amount_total,
        currency: String(session.currency).toUpperCase(),
        paidAt: new Date(event.created * 1000),
      });
      return Response.json({ received: true });
    }

    const { event, transaction: t } = verifyWechat(body, request.headers, {
      platformKey: process.env.WECHAT_PLATFORM_PUBLIC_KEY!.replace(/\\n/g, "\n"),
      platformKeyId: process.env.WECHAT_PLATFORM_KEY_ID!,
      apiV3Key: process.env.WECHAT_API_V3_KEY!,
    });
    if (
      event.event_type !== "TRANSACTION.SUCCESS" ||
      t.trade_state !== "SUCCESS" ||
      t.trade_type !== "NATIVE" ||
      t.mchid !== process.env.WECHAT_MCH_ID ||
      t.appid !== process.env.WECHAT_APP_ID
    ) {
      throw new BillingError("INVALID_EVENT", "Payment event does not match merchant");
    }
    await fulfillPayment(pool, {
      provider,
      eventId: event.id,
      transactionId: t.transaction_id,
      providerId: t.out_trade_no,
      orderId: t.out_trade_no,
      amount: t.amount?.total,
      currency: t.amount?.currency,
      paidAt: new Date(t.success_time),
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    const result = billingErrorResponse(error);
    return Response.json(result.body, { status: result.status });
  }
}
