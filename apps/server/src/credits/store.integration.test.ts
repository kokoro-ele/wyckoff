import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { migrateBilling } from "../billing/migrate.js";
import { migrateCredits } from "./migrate.js";
import {
  registerCreditAccount,
  grantVerifiedCredits,
  creditStatus,
  reserveCredit,
  finalizeCredit,
} from "./store.js";

// Dedicated disposable database only: this suite truncates its fixtures.
const url = process.env.TEST_DATABASE_URL ?? process.env.CREDITS_TEST_DATABASE_URL;

describe.skipIf(!url)("credit PostgreSQL transactions", () => {
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
    await pool.query('TRUNCATE "user" CASCADE');
    // `existing` predates the credit migration. `late` proves the fallback for
    // a failed user.create hook: created after the migration, never registered.
    await pool.query(`
      INSERT INTO "user"(id,"emailVerified","createdAt") VALUES
        ('alice',true,'2020-01-01T00:00:00Z'),
        ('bob',true,'2020-01-01T00:00:00Z'),
        ('unverified',false,'2020-01-01T00:00:00Z'),
        ('existing',true,'2020-01-01T00:00:00Z'),
        ('late',true,now())
    `);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function use(key: string, success: boolean, rollback = false) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      // Same per-account serialization as the workspace row lock.
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('test:alice',0))");
      const id = await reserveCredit(db, "alice", key);
      await finalizeCredit(db, "alice", id, success);
      await db.query(rollback ? "ROLLBACK" : "COMMIT");
      return id;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }

  it("grants only verified new accounts once, rewards referrals once, and recovers a failed signup hook", async () => {
    await registerCreditAccount(pool, "alice");
    await grantVerifiedCredits(pool, "alice");
    const alice = await creditStatus(pool, "alice");

    await registerCreditAccount(pool, "bob", alice.inviteCode);
    await Promise.all(Array.from({ length: 8 }, () => grantVerifiedCredits(pool, "bob")));

    expect((await creditStatus(pool, "alice")).balance).toBe(6);
    expect((await creditStatus(pool, "alice")).inviteCount).toBe(1);
    expect((await creditStatus(pool, "bob")).balance).toBe(3);
    // A pre-migration account is not retroactively gifted.
    expect((await creditStatus(pool, "existing")).balance).toBe(0);
    // A user whose create hook failed after the migration still gets the welcome grant.
    expect((await creditStatus(pool, "late")).balance).toBe(3);

    await registerCreditAccount(pool, "unverified");
    await expect(grantVerifiedCredits(pool, "unverified")).rejects.toMatchObject({ code: "EMAIL_UNVERIFIED" });
    await expect(registerCreditAccount(pool, "alice", alice.inviteCode)).rejects.toMatchObject({
      code: "INVALID_INVITE",
    });
    await expect(registerCreditAccount(pool, "existing", "invalid")).rejects.toMatchObject({
      code: "INVALID_INVITE",
    });
  });

  it("serializes competing reservations and never overspends", async () => {
    await registerCreditAccount(pool, "alice");
    await grantVerifiedCredits(pool, "alice");

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => use(`request-${i}`, true)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect((await creditStatus(pool, "alice")).balance).toBe(0);
  });

  it("rolls back interrupted work, refunds failed work, and allows a refunded key to retry", async () => {
    await registerCreditAccount(pool, "alice");
    await grantVerifiedCredits(pool, "alice");

    await use("rollback-request", true, true);
    expect((await creditStatus(pool, "alice")).balance).toBe(3);

    await use("failed-request", false);
    expect((await creditStatus(pool, "alice")).balance).toBe(3);

    await use("stable-request", true);
    await expect(use("stable-request", true)).rejects.toMatchObject({ code: "DUPLICATE_REQUEST" });
    expect((await creditStatus(pool, "alice")).balance).toBe(2);

    await use("retryable-request", false);
    expect((await creditStatus(pool, "alice")).balance).toBe(2);
    await use("retryable-request", true);
    expect((await creditStatus(pool, "alice")).balance).toBe(1);
  });
});
