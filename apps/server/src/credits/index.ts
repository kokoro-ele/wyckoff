import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Pool } from "pg";
import { BillingError, billingErrorResponse } from "../billing/catalog.js";
import { availability } from "../billing/providers.js";
import { checkoutCreditPack, currentOrder, getOrder } from "../billing/store.js";
import {
  checkoutSubscription,
  currentSubscriptionOrder,
  getSubscriptionOrder,
} from "../billing/subscriptionStore.js";
import { subscriptionCatalog } from "../billing/subscriptionCatalog.js";
import { getEntitlement, hasEntitlement } from "../billing/entitlements.js";
import { creditPacks } from "./catalog.js";
import { creditStatus } from "./store.js";

export function createCreditsRouter(pool: Pool, userId: string) {
  const app = new Hono();
  app.onError((error, c) => {
    const result = billingErrorResponse(error);
    return c.json(result.body, result.status);
  });

  app.get("/status", async (c) => c.json(await creditStatus(pool, userId)));
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
  app.get("/orders/current", async (c) => c.json({ order: await currentOrder(pool, userId) }));
  app.get("/orders/:id", async (c) => c.json(await getOrder(pool, userId, c.req.param("id"))));

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
