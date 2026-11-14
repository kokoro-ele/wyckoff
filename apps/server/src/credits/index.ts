import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Pool } from "pg";
import { BillingError, billingErrorResponse } from "../billing/catalog.js";
import { availability } from "../billing/providers.js";
import { checkoutCreditPack, currentOrder, getOrder } from "../billing/store.js";
import {
  checkoutSubscription,
  createBillingPortal,
  currentSubscriptionOrder,
  getSubscriptionOrder,
} from "../billing/subscriptionStore.js";
import { subscriptionCatalog } from "../billing/subscriptionCatalog.js";
import { getEntitlement, hasEntitlement } from "../billing/entitlements.js";
import { creditPacks } from "./catalog.js";
import { claimDailyLogin, creditStatus } from "./store.js";
import { feedbackStatus, submitFeedback } from "./feedback.js";

export function createCreditsRouter(pool: Pool, userId: string) {
  const app = new Hono();
  app.onError((error, c) => {
    const result = billingErrorResponse(error);
    return c.json(result.body, result.status);
  });

  app.get("/status", async (c) => c.json(await creditStatus(pool, userId)));
  app.post("/daily-login", async (c) => c.json(await claimDailyLogin(pool, userId)));
  app.get("/feedback/status", async (c) => c.json(await feedbackStatus(pool, userId)));
  app.post("/feedback", bodyLimit({ maxSize: 8 * 1024 }), async (c) => {
    const body = (await c.req.json().catch(() => null)) as { rating?: unknown; comment?: unknown } | null;
    const rating = Number(body?.rating);
    const comment = typeof body?.comment === "string" ? body.comment.trim() : "";
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return c.json({ code: "BAD_REQUEST", message: "请选择 1–5 分评分" }, 400);
    }
    return c.json(await submitFeedback(pool, userId, rating, comment));
  });
  app.get("/catalog", (c) => c.json({ packs: creditPacks(), providers: availability() }));
  app.get("/subscriptions/catalog", (c) => c.json({ products: subscriptionCatalog() }));
  app.get("/subscriptions/status", async (c) => {
    const entitlement = await getEntitlement(pool, userId, "byok");
    return c.json({
      byok: await hasEntitlement(pool, userId, "byok"),
      entitlement: entitlement
        ? {
            source: entitlement.source,
            status: entitlement.status,
            currentPeriodEnd: entitlement.current_period_end?.toISOString() ?? null,
          }
        : null,
    });
  });
  app.get("/subscriptions/orders/current", async (c) => c.json({ order: await currentSubscriptionOrder(pool, userId) }));
  app.get("/subscriptions/orders/:id", async (c) => c.json(await getSubscriptionOrder(pool, userId, c.req.param("id"))));
  app.get("/purchases", async (c) => {
    const [credits, subscriptions] = await Promise.all([
      pool.query<{
        id: string;
        product: string;
        credits: number | null;
        amount: number;
        currency: string;
        status: string;
        created_at: Date;
        paid_at: Date | null;
      }>(
        `SELECT id, plan AS product, credits, amount, currency, status, created_at, paid_at
         FROM billing_orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
        [userId],
      ),
      pool.query<{
        id: string;
        product: string;
        mode: string;
        amount: number;
        currency: string;
        status: string;
        created_at: Date;
        paid_at: Date | null;
      }>(
        `SELECT id, product, mode, amount, currency, status, created_at, paid_at
         FROM subscription_orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
        [userId],
      ),
    ]);
    return c.json({
      purchases: [
        ...credits.rows.map((row) => ({ ...row, kind: "credits" as const })),
        ...subscriptions.rows.map((row) => ({ ...row, kind: "subscription" as const })),
      ]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 80),
    });
  });

  app.get("/orders/current", async (c) => c.json({ order: await currentOrder(pool, userId) }));
  app.get("/orders/:id", async (c) => c.json(await getOrder(pool, userId, c.req.param("id"))));

  app.post("/subscriptions/portal", async (c) => {
    return c.json({ url: await createBillingPortal(pool, userId) });
  });

  app.post("/subscriptions/checkout", bodyLimit({ maxSize: 4096 }), async (c) => {
    const body = (await c.req.json().catch(() => null)) as { productId?: unknown; provider?: unknown } | null;
    if (!body || typeof body.productId !== "string" || body.provider !== "stripe") {
      throw new BillingError("INVALID_CHECKOUT", "Invalid checkout body");
    }
    return c.json(
      await checkoutSubscription(pool, userId, body.productId, c.req.header("Idempotency-Key") ?? ""),
    );
  });

  app.post("/checkout", bodyLimit({ maxSize: 4096 }), async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      packId?: unknown;
      provider?: unknown;
    } | null;
    if (!body || typeof body.packId !== "string" || typeof body.provider !== "string") {
      throw new BillingError("INVALID_CHECKOUT", "Invalid checkout body");
    }
    return c.json(
      await checkoutCreditPack(pool, userId, { packId: body.packId, provider: body.provider }, c.req.header("Idempotency-Key") ?? ""),
    );
  });
  return app;
}
