import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BacktestResult } from "@wyckoff/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDataDir = mkdtempSync(path.join(tmpdir(), "wyckoff-backtests-"));
const previousDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = testDataDir;

let store: typeof import("./backtests.js");
let database: typeof import("../db/index.js");

const result: BacktestResult = {
  id: "bt_store_test",
  createdAt: 1_700_000_000_000,
  engineVersion: "test",
  strategyName: "均线交叉",
  strategyDescription: "测试策略",
  request: {
    symbol: "TEST.US",
    period: "1d",
    adjust: "forward",
    initialCapital: 100_000,
    positionSizePct: 100,
    commissionBps: 5,
    slippageBps: 5,
    stopLossPct: 8,
    takeProfitPct: 20,
    maxHoldingBars: 120,
    strategy: { type: "ma_cross", fastPeriod: 20, slowPeriod: 60 },
  },
  data: {
    barCount: 300,
    startTime: 1_600_000_000_000,
    endTime: 1_700_000_000_000,
    warmupBars: 60,
    actualWarmupBars: 60,
  },
  metrics: {
    totalReturnPct: 12.3,
    benchmarkReturnPct: 8.1,
    excessReturnPct: 4.2,
    annualizedReturnPct: 10,
    annualizedVolatilityPct: 15,
    sharpeRatio: 0.67,
    maxDrawdownPct: 6.5,
    tradeCount: 2,
    winningTrades: 1,
    losingTrades: 1,
    winRatePct: 50,
    profitFactor: 1.5,
    averageTradePct: 3,
    averageHoldingBars: 12,
    exposurePct: 20,
    totalFees: 20,
  },
  curve: [],
  trades: [],
  warnings: [],
};

beforeAll(async () => {
  store = await import("./backtests.js");
  database = await import("../db/index.js");
});

afterAll(() => {
  database.db.close();
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  rmSync(testDataDir, { recursive: true, force: true });
});

describe("backtest store", () => {
  it("persists, summarizes, loads and deletes one immutable result", () => {
    store.saveBacktest(result);

    expect(store.listBacktests(10)).toEqual([
      expect.objectContaining({
        id: result.id,
        symbol: "TEST.US",
        strategy: "ma_cross",
        totalReturnPct: 12.3,
        tradeCount: 2,
      }),
    ]);
    expect(store.getBacktest(result.id)).toEqual(result);
    expect(store.deleteBacktest(result.id)).toBe(true);
    expect(store.getBacktest(result.id)).toBeUndefined();
    expect(store.deleteBacktest(result.id)).toBe(false);
  });
});
