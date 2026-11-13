import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { workspaceContext, type WorkspaceContext } from "../cloud/context.js";
import { initializeDatabase } from "../db/schema.js";
import * as memory from "./agentMemory.js";

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

describe("agent research memory", () => {
  it("keeps focus, conclusions, corrections and unfinished questions", async () => {
    const value = context("alice");
    await workspaceContext.run(value, async () => {
      memory.rememberFocus({
        symbol: "AAPL.US",
        period: "1d",
        sessionId: "s1",
        question: "8 月 27 日这根是不是 UT？",
        intent: "event",
        steps: ["读取区间", "核对量价"],
      });
      memory.rememberConclusion({
        symbol: "AAPL.US",
        period: "1d",
        sessionId: "s1",
        content: "08-27 更像 UT 后的测试，尚未破位。",
      });
      memory.rememberCorrection({
        symbol: "AAPL.US",
        period: "1d",
        sessionId: "s1",
        content: "不对，画布上的是 8 月 27 日。",
      });
      memory.rememberOpen({ symbol: "AAPL.US", period: "1d", sessionId: "s1", content: "核对 9 月 28 日是否破位" });

      const snapshot = memory.getSnapshot("AAPL.US", "1d");
      expect(snapshot.focus?.content).toContain("8 月 27");
      expect(snapshot.conclusions[0].content).toContain("UT");
      expect(snapshot.corrections[0].content).toContain("不对");
      expect(snapshot.open[0].content).toContain("9 月 28");
      expect(memory.formatMemoryPrompt(snapshot, "zh")).toContain("跨会话研究记忆");

      memory.resolveOpen("AAPL.US", "1d");
      expect(memory.getSnapshot("AAPL.US", "1d").open).toHaveLength(0);
    });
  });

  it("detects corrections and resume prompts", () => {
    expect(memory.looksLikeCorrection("日期相差一天，应该标 8-27")).toBe(true);
    expect(memory.looksLikeCorrection("继续分析这里的 Spring")).toBe(false);
    expect(memory.isResumeMessage("继续上次未完成的分析")).toBe(true);
    expect(memory.isResumeMessage("resume")).toBe(true);
  });
});
