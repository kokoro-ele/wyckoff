import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Pool } from "pg";
import { BillingError, billingErrorResponse } from "../billing/catalog.js";
import { availability } from "../billing/providers.js";
import { checkoutCreditPack, currentOrder, getOrder } from "../billing/store.js";
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
  app.get("/orders/current", async (c) => c.json({ order: await currentOrder(pool, userId) }));
  app.get("/orders/:id", async (c) => c.json(await getOrder(pool, userId, c.req.param("id"))));

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
