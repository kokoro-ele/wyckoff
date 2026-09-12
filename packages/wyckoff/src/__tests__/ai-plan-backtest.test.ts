import { describe, expect, it } from "vitest";
import type { AiWyckoffBacktestRequestInput, AiWyckoffDecision, Kline } from "@wyckoff/shared";
import {
  buildAiWyckoffAnonymousSnapshot,
  runAiWyckoffPlanBacktest,
  scanAiWyckoffDecisionCandidates,
} from "../ai-plan-backtest.js";

const DAY = 86_400_000;
const START = Date.UTC(2023, 0, 1);

function bar(index: number, close: number, options: Partial<Omit<Kline, "timestamp" | "close">> = {}): Kline {
  const open = options.open ?? close;
  const volume = options.volume ?? 100;
  return {
    timestamp: START + index * DAY,
    open,
    high: options.high ?? Math.max(open, close) + 1,
    low: options.low ?? Math.min(open, close) - 1,
    close,
    volume,
    amount: options.amount ?? close * volume,
  };
}

function request(overrides: Partial<AiWyckoffBacktestRequestInput> = {}): AiWyckoffBacktestRequestInput {
  return {
    symbol: "TEST.US",
    period: "1d",
    adjust: "none",
    initialCapital: 100_000,
    positionSizePct: 100,
    commissionBps: 0,
    slippageBps: 0,
    maxHoldingBars: 30,
    contextBars: 40,
    rangeLookback: 10,
    planValidBars: 5,
    maxAiDecisions: 40,
    minDecisionGapBars: 1,
    ...overrides,
  };
}

function observeDecision(index: number): AiWyckoffDecision {
  return {
    decisionBarIndex: index,
    kind: "observe",
    phase: "unknown",
    event: null,
    action: "observe",
    evidence: [{ barId: `BAR_${String(index + 1).padStart(6, "0")}`, observation: "只有匿名 K 量证据" }],
    missingConfirmation: [],
    invalidation: [],
    audit: {},
  };
}

describe("AI Wyckoff 匿名输入", () => {
  it("只暴露匿名编号和归一化 OHLCV，不含代码、日期、时间戳、成交额或指标", () => {
    const bars = Array.from({ length: 60 }, (_, index) => bar(index, 90 + index * 0.2, { amount: 987_654_321 }));
    const snapshot = buildAiWyckoffAnonymousSnapshot({ klines: bars, decisionBarIndex: 59, contextBars: 40 });
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.asset).toBe("ASSET_001");
    expect(snapshot.decisionBarId).toBe("BAR_000060");
    expect(snapshot.bars.at(-1)?.close).toBe(100);
    expect(Object.keys(snapshot.bars[0]).sort()).toEqual(["barId", "close", "high", "low", "open", "volume"]);
    expect(serialized).not.toContain("TEST.US");
    expect(serialized).not.toContain(String(START));
    expect(serialized).not.toContain("987654321");
    expect(serialized).not.toMatch(/timestamp|amount|symbol|date|news|MA20|ATR|relativeStrength/i);
  });
});

describe("AI Wyckoff 候选扫描", () => {
  it("追加未来 K 线不会改写此前已经产生的候选", () => {
    const base = Array.from({ length: 41 }, (_, index) => bar(index, index % 2 === 0 ? 99 : 101));
    base.push(bar(41, 100, { open: 99, high: 102, low: 94, volume: 240 }));
    base.push(bar(42, 101, { high: 102, low: 99, volume: 80 }));
    const before = scanAiWyckoffDecisionCandidates({ request: request(), klines: base });
    const extended = [
      ...base,
      bar(43, 150, { high: 160, low: 90, volume: 10_000 }),
      bar(44, 40, { high: 170, low: 30, volume: 20_000 }),
    ];
    const after = scanAiWyckoffDecisionCandidates({ request: request(), klines: extended })
      .filter((candidate) => candidate.decisionBarIndex < base.length);

    expect(before).toEqual(after);
    expect(before.some((candidate) => candidate.reasons.includes("spring_or_shakeout"))).toBe(true);
  });
});

describe("AI Wyckoff 计划撮合", () => {
  it("计划在决策次根起触发，并按结构目标完成一笔交易", () => {
    const bars = Array.from({ length: 16 }, (_, index) => bar(index, 100));
    bars[11] = bar(11, 101, { open: 100, high: 102, low: 99 });
    bars[12] = bar(12, 104, { open: 102, high: 106, low: 101 });
    const decision: AiWyckoffDecision = {
      decisionBarIndex: 10,
      kind: "spring_test_long",
      phase: "C",
      event: "Test",
      action: "enter_long",
      entryLevel: 101,
      stopLevel: 98,
      targetLevel: 105,
      evidence: [{ barId: "BAR_000011", observation: "Spring 后缩量测试，收盘守住区间" }],
      missingConfirmation: ["等待突破测试 K 线高点"],
      invalidation: ["跌破 Spring 低点"],
      audit: { model: "fake-model" },
    };

    const result = runAiWyckoffPlanBacktest({ id: "ai-next-bar", request: request(), klines: bars, decisions: [decision] });

    expect(result.asset).toBe("ASSET_001");
    expect(JSON.stringify(result)).not.toContain("TEST.US");
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      entrySignalBarIndex: 10,
      entryBarIndex: 11,
      entryPrice: 101,
      exitBarIndex: 12,
      exitPrice: 105,
      exitReason: "take_profit",
    });
    expect(result.plans[0]).toMatchObject({ status: "closed", triggeredBarIndex: 11, completedBarIndex: 12 });
  });

  it("观察决策不会生成订单，也不会泄露实际标的", () => {
    const bars = Array.from({ length: 20 }, (_, index) => bar(index, 100 + index * 0.1));
    const result = runAiWyckoffPlanBacktest({ request: request(), klines: bars, decisions: [observeDecision(10)] });
    expect(result.plans[0].status).toBe("observed");
    expect(result.trades).toHaveLength(0);
    expect(result.curve.every((point) => point.inMarket === false)).toBe(true);
  });
});
