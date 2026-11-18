import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { db } from "../db/index.js";
import { getPool } from "../cloud/postgres.js";
import { withWorkspace } from "../cloud/workspace.js";
import { beginWorkspaceUsage } from "./workspace.js";
import { migrateBilling } from "./migrate.js";
import { migrateCredits } from "../credits/migrate.js";
import { creditStatus, grantVerifiedCredits, registerCreditAccount } from "../credits/store.js";

const url = process.env.TEST_DATABASE_URL ?? process.env.CREDITS_TEST_DATABASE_URL;

describe.skipIf(!url)("workspace + credit finalization", () => {
  const pool = new Pool({ connectionString: url, max: 5 });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.WORKSPACE_ENCRYPTION_KEY = "ab".repeat(32);
    await pool.query(
      `CREATE TABLE IF NOT EXISTS "user"(
        id TEXT PRIMARY KEY,
        "emailVerified" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
    );
    await migrateBilling(pool);
    await migrateCredits(pool);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
        payload BYTEA,
        version INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE "user" CASCADE');
    await pool.query(
      `INSERT INTO "user"(id,"emailVerified","createdAt") VALUES('alice',true,'2020-01-01T00:00:00Z')`,
    );
    await registerCreditAccount(pool, "alice");
    await grantVerifiedCredits(pool, "alice");
  });

  afterAll(async () => {
    await pool.end();
    await getPool().end();
  });

  it("persists the result and consumes the credit only after the workspace commit", async () => {
    await withWorkspace("alice", true, async () => {
      const lease = await beginWorkspaceUsage("success-key");
      db.prepare("INSERT INTO app_state(key,value) VALUES('probe','ok') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
      await lease.complete();
    });

    expect((await creditStatus(pool, "alice")).balance).toBe(2);

    const persisted = await withWorkspace("alice", false, async () =>
      db.prepare<[string], { value: string }>("SELECT value FROM app_state WHERE key=?").get("probe"),
    );
    expect(persisted.value).toEqual({ value: "ok" });
  });

  it("refunds the credit when the workspace transaction rolls back", async () => {
    await expect(
      withWorkspace("alice", true, async () => {
        await beginWorkspaceUsage("failure-key");
        throw new Error("save failed");
      }),
    ).rejects.toThrow("save failed");

    expect((await creditStatus(pool, "alice")).balance).toBe(3);
  });

  it("commits a released credit for a failed analysis and allows the key to retry", async () => {
    await withWorkspace("alice", true, async () => {
      await beginWorkspaceUsage("released-key");
      // An analysis error path returns normally without lease.complete().
    });
    expect((await creditStatus(pool, "alice")).balance).toBe(3);

    await withWorkspace("alice", true, async () => {
      const lease = await beginWorkspaceUsage("released-key");
      await lease.complete();
    });
    expect((await creditStatus(pool, "alice")).balance).toBe(2);
  });

  it("never blocks the user's other writes during an analysis and keeps both results", async () => {
    const before = (await creditStatus(pool, "alice")).balance;
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    let reserved!: () => void;
    const reservedSignal = new Promise<void>((resolve) => (reserved = resolve));

    const analysis = withWorkspace("alice", "optimistic", async () => {
      const lease = await beginWorkspaceUsage("long-running-key");
      reserved();
      db.prepare("INSERT INTO app_state(key,value) VALUES('analysis','done') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
      await gate;
      await lease.complete();
    });
    await reservedSignal;

    // A normal write commits immediately while the analysis is still running.
    const started = Date.now();
    await withWorkspace("alice", true, async () => {
      db.prepare("INSERT INTO app_state(key,value) VALUES('setting','kept') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    // The reservation is already committed, outside any long transaction.
    expect((await creditStatus(pool, "alice")).balance).toBe(before - 1);

    finish();
    await analysis;

    const persisted = await withWorkspace("alice", false, async () =>
      db.prepare<[], { key: string; value: string }>("SELECT key,value FROM app_state WHERE key IN ('analysis','setting') ORDER BY key").all(),
    );
    expect(persisted.value).toEqual([
      { key: "analysis", value: "done" },
      { key: "setting", value: "kept" },
    ]);
    expect((await creditStatus(pool, "alice")).balance).toBe(before - 1);
  });

  it("refunds an optimistic analysis that fails", async () => {
    const before = (await creditStatus(pool, "alice")).balance;
    await expect(
      withWorkspace("alice", "optimistic", async () => {
        await beginWorkspaceUsage("optimistic-failure-key");
        throw new Error("model failed");
      }),
    ).rejects.toThrow("model failed");
    expect((await creditStatus(pool, "alice")).balance).toBe(before);
  });
});

