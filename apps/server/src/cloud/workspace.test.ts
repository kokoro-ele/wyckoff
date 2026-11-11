import Database from "better-sqlite3";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { workspaceContext, type WorkspaceContext } from "./context.js";
import { initializeDatabase } from "../db/schema.js";
import { db } from "../db/index.js";
import { decodeWorkspace, encodeWorkspace } from "./workspace.js";
import { config } from "../config.js";
import { getOpenAiClient } from "../llm/client.js";

vi.hoisted(() => {
  vi.stubEnv("OPENAI_API_KEY", "operator-test-key");
});
afterAll(() => vi.unstubAllEnvs());

const databases: Database.Database[] = [];
function context(userId: string): WorkspaceContext {
  const database = new Database(":memory:");
  initializeDatabase(database);
  databases.push(database);
  return {
    userId,
    database,
    dirty: false,
    deferred: [],
    state: new Map(),
    deadline: Date.now() + 240_000,
  };
}
afterEach(() => databases.splice(0).forEach((database) => database.close()));

describe("cloud workspace isolation", () => {
  it("keeps cached statements and transactions scoped across interleaved users", async () => {
    const a = context("alice");
    const b = context("bob");
    const insert = db.prepare("INSERT INTO sessions (id, symbol, period, title, created_at, updated_at) VALUES (?, 'TEST.US', '1d', ?, 1, 1)");
    const list = db.prepare<[], { title: string }>("SELECT title FROM sessions");
    const save = db.transaction((title: string) => insert.run("same-id", title));
    await Promise.all(
      [a, b].map((value) =>
        workspaceContext.run(value, async () => {
          save(value.userId);
          await new Promise((resolve) => setTimeout(resolve, value.userId === "alice" ? 10 : 1));
          expect(list.all()).toEqual([{ title: value.userId }]);
        }),
      ),
    );
  });

  it("encrypts snapshots, restores data and rejects wrong users and tampering", () => {
    const previous = process.env.WORKSPACE_ENCRYPTION_KEY;
    process.env.WORKSPACE_ENCRYPTION_KEY = "ab".repeat(32);
    try {
      const value = context("alice");
      value.database.prepare("INSERT INTO app_state (key, value) VALUES ('private', 'secret-data')").run();
      const encoded = encodeWorkspace(value.database, "alice");
      expect(encoded.includes(Buffer.from("secret-data"))).toBe(false);
      const restored = new Database(decodeWorkspace(encoded, "alice"));
      databases.push(restored);
      expect(restored.prepare("SELECT value FROM app_state WHERE key = 'private'").get()).toEqual({ value: "secret-data" });
      expect(() => decodeWorkspace(encoded, "bob")).toThrow();
      encoded[encoded.length - 1] ^= 1;
      expect(() => decodeWorkspace(encoded, "alice")).toThrow();
    } finally {
      if (previous === undefined) delete process.env.WORKSPACE_ENCRYPTION_KEY;
      else process.env.WORKSPACE_ENCRYPTION_KEY = previous;
    }
  });

  it("uses operator credentials and isolates client instances between accounts", () => {
    const a = context("alice");
    const b = context("bob");
    const first = workspaceContext.run(a, () => getOpenAiClient());
    const second = workspaceContext.run(b, () => getOpenAiClient());
    expect(first).not.toBe(second);
    expect(first.apiKey).toBe(config.llm.apiKey);
    expect(second.apiKey).toBe(config.llm.apiKey);
    expect(first.apiKey).toBe("operator-test-key");
    workspaceContext.run(a, () => {
      expect(getOpenAiClient()).toBe(first);
    });
  });
});
