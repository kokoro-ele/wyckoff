import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { migrateBilling } from "./migrate.js";
import { migrateCredits } from "../credits/migrate.js";
import { checkoutCreditPack, currentOrder, fulfillPayment, getOrder } from "./store.js";
import { creditStatus } from "../credits/store.js";

// Dedicated disposable database only. Never point this at a user or production database.
const url =
  process.env.TEST_DATABASE_URL ??
  process.env.BILLING_TEST_DATABASE_URL ??
  process.env.CREDITS_TEST_DATABASE_URL;

describe.skipIf(!url)("billing PostgreSQL transactions", () => {
  const pool = new Pool({ connectionString: url, max: 20 });

  beforeAll(async () => {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS "user"(
        id TEXT PRIMARY KEY,
        "emailVerified" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    );
    await migrateBilling(pool);
    await migrateCredits(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE api_rate_limits');
    await pool.query('TRUNCATE billing_usage,billing_events,billing_orders,billing_subscriptions,"user" CASCADE');
    await pool.query(
      `INSERT INTO "user"(id,"emailVerified","createdAt") VALUES
        ('alice',true,'2020-01-01T00:00:00Z'),
        ('bob',true,'2020-01-01T00:00:00Z')`,
    );
    vi.stubEnv("BILLING_PUBLIC_ORIGIN", "https://example.com");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_local");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_local");
    vi.stubEnv(
      "ANALYSIS_CREDIT_PACKS",
      JSON.stringify([{ id: "ten", name: "10 次", credits: 10, amount: 1000, currency: "USD" }]),
    );
  });

  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    vi.unstubAllEnvs();
    await pool.end();
  });

  it("creates a server-priced pack order and reuses the same idempotency key", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            id: "cs_test_1",
            url: "https://checkout.stripe.com/c/pay/cs_test_1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const first = await checkoutCreditPack(pool, "alice", { packId: "ten", provider: "stripe" }, "pack-key-1");
    expect(first.status).toBe("pending");
    const again = await checkoutCreditPack(pool, "alice", { packId: "ten", provider: "stripe" }, "pack-key-1");
    expect(again.orderId).toBe(first.orderId);
    await expect(
      checkoutCreditPack(pool, "alice", { packId: "ten", provider: "stripe" }, "pack-key-2"),
    ).rejects.toMatchObject({ code: "PENDING_CHECKOUT" });

    expect((await getOrder(pool, "alice", first.orderId)).status).toBe("pending");
    expect(await currentOrder(pool, "bob")).toBeNull();
    await expect(getOrder(pool, "bob", first.orderId)).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
  });

  it("adds permanent pack credits exactly once across replay and concurrent delivery", async () => {
    await pool.query(`
      INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period,credits,amount,currency,status,expires_at)
      VALUES('pack-order','alice','pack-key','stripe','ten','permanent',10,1000,'USD','pending',now()+interval '1 hour')
    `);
    const payment = {
      provider: "stripe" as const,
      eventId: "evt1",
      transactionId: "pi1",
      orderId: "pack-order",
      providerId: "cs1",
      amount: 1000,
      currency: "USD",
      paidAt: new Date(),
    };

    await expect(fulfillPayment(pool, { ...payment, amount: 1 })).rejects.toMatchObject({
      code: "PAYMENT_MISMATCH",
    });
    await Promise.all(Array.from({ length: 8 }, () => fulfillPayment(pool, payment)));
    await fulfillPayment(pool, { ...payment, eventId: "evt2" });

    expect((await creditStatus(pool, "alice")).balance).toBe(10);
    expect(Number((await pool.query("SELECT count(*) FROM billing_events")).rows[0].count)).toBe(1);
  });

  it("extends legacy subscriptions without downgrading an active Research plan", async () => {
    await pool.query(
      "INSERT INTO billing_subscriptions(user_id,plan,expires_at) VALUES('alice','research',now()+interval '10 days')",
    );
    await pool.query(`
      INSERT INTO billing_orders(id,user_id,idempotency_key,provider,plan,period,amount,currency,status,expires_at)
      VALUES('sub-order','alice','sub-key','stripe','pro','monthly',900,'USD','pending',now()+interval '1 hour')
    `);
    await fulfillPayment(pool, {
      provider: "stripe",
      eventId: "evt-sub",
      transactionId: "pi-sub",
      orderId: "sub-order",
      providerId: "cs-sub",
      amount: 900,
      currency: "USD",
      paidAt: new Date(),
    });
    const subscription = (await pool.query('SELECT plan FROM billing_subscriptions WHERE user_id=$1', ["alice"]))
      .rows[0];
    expect(subscription.plan).toBe("research");
    expect((await pool.query("SELECT status FROM billing_orders WHERE id='sub-order'")).rows[0].status).toBe("paid");
  });
});
