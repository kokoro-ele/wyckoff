import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDataDir = mkdtempSync(path.join(tmpdir(), "wyckoff-ai-backtests-"));
const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = testDataDir;

let store: typeof import("./aiBacktests.js");
let database: typeof import("../db/index.js");
let planLlm: typeof import("./wyckoffPlanLlm.js");

beforeAll(async () => {
  store = await import("./aiBacktests.js");
  database = await import("../db/index.js");
  planLlm = await import("./wyckoffPlanLlm.js");
});

afterAll(() => {
  database.db.close();
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  rmSync(testDataDir, { recursive: true, force: true });
});

describe("AI Wyckoff backtest store", () => {
  it("persists progress, audited calls, cache entries and a terminal result", () => {
    store.createAiBacktestRun({
      id: "aibt_store_test",
      createdAt: 1_700_000_000_000,
      symbol: "TEST.US",
      period: "1d",
      adjust: "forward",
      model: "test-model",
      promptVersion: "prompt-v1",
      request: { symbol: "TEST.US", period: "1d" },
    });
    expect(store.markAiBacktestRunning("aibt_store_test")).toBe(true);
    store.setAiBacktestRangeAndProgress("aibt_store_test", 100, 200, 2);

    store.saveAiBacktestCall({
      id: "aic_store_test",
      runId: "aibt_store_test",
      createdAt: 1_700_000_000_100,
      asOfIndex: 42,
      asOfTime: 123_456,
      candidateKey: "BAR_000043:initial_review",
      status: "completed",
      inputHash: "hash-1",
      anonymousInput: {
        asset: "ASSET_001",
        decisionBarId: "BAR_000043",
        bars: [{ barId: "BAR_000043", open: 99, high: 102, low: 98, close: 100, volume: 1 }],
      },
      rawOutput: '{"kind":"observe"}',
      parsedOutput: { decisionBarIndex: 42, kind: "observe" },
      model: "test-model",
      promptVersion: "prompt-v1",
      responseId: "resp_test",
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      durationMs: 25,
    });
    store.updateAiBacktestProgress("aibt_store_test", 1);

    expect(store.findCachedAiBacktestCall("hash-1", "test-model", "prompt-v1")).toEqual(
      expect.objectContaining({ id: "aic_store_test", responseId: "resp_test", totalTokens: 120 }),
    );
    expect(store.listAiBacktestCalls("aibt_store_test")).toEqual([
      expect.objectContaining({
        id: "aic_store_test",
        status: "completed",
        cacheHit: false,
        anonymousInput: expect.objectContaining({ asset: "ASSET_001" }),
      }),
    ]);

    expect(store.deleteAiBacktestRun("aibt_store_test")).toBe("not_terminal");
    expect(store.completeAiBacktestRun("aibt_store_test", { id: "result-1" }, "engine-v1")).toBe(true);
    expect(store.getAiBacktestRun("aibt_store_test")).toEqual(
      expect.objectContaining({
        status: "completed",
        progressCurrent: 2,
        progressTotal: 2,
        result: { id: "result-1" },
      }),
    );
    expect(store.deleteAiBacktestRun("aibt_store_test")).toBe("deleted");
    expect(store.listAiBacktestCalls("aibt_store_test")).toEqual([]);
  });

  it("marks queued or running jobs failed after restart recovery", () => {
    store.createAiBacktestRun({
      id: "aibt_interrupted",
      createdAt: 1_700_000_000_000,
      symbol: "TEST.US",
      period: "1d",
      adjust: "forward",
      model: "test-model",
      promptVersion: "prompt-v1",
      request: {},
    });
    expect(store.failInterruptedAiBacktests()).toBe(1);
    expect(store.getAiBacktestRun("aibt_interrupted")).toEqual(
      expect.objectContaining({ status: "failed", error: "服务重启，任务已中断" }),
    );
  });
});

describe("AI Wyckoff plan parser", () => {
  const candidate = {
    decisionBarIndex: 42,
    barId: "BAR_000043",
    reasons: ["initial_review" as const],
  };
  const snapshot = {
    asset: "ASSET_001" as const,
    decisionBarId: "BAR_000043",
    priceBase: "DECISION_CLOSE_100" as const,
    volumeBase: "TRAILING_MEDIAN_20_1" as const,
    bars: [{ barId: "BAR_000043", open: 99, high: 102, low: 98, close: 100, volume: 1 }],
  };

  it("injects the server-owned decision index and accepts in-window evidence", () => {
    const parsed = planLlm.parseAiWyckoffModelDecision(
      JSON.stringify({
        kind: "observe",
        phase: "unknown",
        event: null,
        action: "observe",
        evidence: [{ barId: "BAR_000043", observation: "价量证据不足，继续观察" }],
        missingConfirmation: ["尚无区间突破"],
        invalidation: [],
      }),
      candidate,
      snapshot,
    );
    expect(parsed).toEqual(expect.objectContaining({ decisionBarIndex: 42, kind: "observe", audit: {} }));
  });

  it("rejects extra fields and evidence outside the anonymous window", () => {
    const base = {
      kind: "observe",
      phase: "unknown",
      event: null,
      action: "observe",
      evidence: [{ barId: "BAR_999999", observation: "不存在的 K 线" }],
      missingConfirmation: [],
      invalidation: [],
    };
    expect(() => planLlm.parseAiWyckoffModelDecision(JSON.stringify(base), candidate, snapshot)).toThrow(
      "匿名窗口外",
    );
    expect(() =>
      planLlm.parseAiWyckoffModelDecision(JSON.stringify({ ...base, unexpected: true }), candidate, snapshot),
    ).toThrow("不符合协议");
  });

  it("rejects external context and inconsistent Wyckoff phase semantics", () => {
    const base = {
      kind: "observe",
      phase: "unknown",
      event: null,
      action: "observe",
      evidence: [{ barId: "BAR_000043", observation: "该公司财报可能改善" }],
      missingConfirmation: [],
      invalidation: [],
    };
    expect(() => planLlm.parseAiWyckoffModelDecision(JSON.stringify(base), candidate, snapshot)).toThrow(
      "Wyckoff 之外",
    );

    expect(() =>
      planLlm.parseAiWyckoffModelDecision(
        JSON.stringify({
          ...base,
          phase: "A",
          event: "Spring",
          evidence: [{ barId: "BAR_000043", observation: "下破区间后收回，成交量扩张" }],
        }),
        candidate,
        snapshot,
      ),
    ).toThrow("Spring 与 Phase A 不一致");
  });
});
