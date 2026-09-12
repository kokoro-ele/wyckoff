import type { RecommendBookItem } from "@wyckoff/shared";
import { describe, expect, it } from "vitest";
import { chooseCapacityRemovals, rotationExitPrice, selectEligibleCandidates } from "./recommendPolicy.js";

function item(symbol: string, conviction: number, bucket: RecommendBookItem["bucket"] = "watch"): RecommendBookItem {
  return {
    symbol,
    name: symbol,
    bucket,
    thesis: "test",
    expectedReturnPct: 10,
    stopPct: 5,
    entryPrice: 100,
    lastPrice: 92,
    actualReturnPct: -8,
    horizonDays: 20,
    conviction,
    openedAt: 1,
    featureMs: 1,
    lastRunId: "run",
    featureEngineVersion: "1.1.0",
    featureSummary: "summary",
    sourceNote: null,
  };
}

describe("selectEligibleCandidates", () => {
  it("不让本轮刚出局的旧标的重新作为新候选进入", () => {
    const hits = [{ symbol: "OLD.US" }, { symbol: "NEW.US" }];
    expect(selectEligibleCandidates(hits, new Set(["OLD.US"]), new Set())).toEqual([{ symbol: "NEW.US" }]);
  });
});

describe("chooseCapacityRemovals", () => {
  it("容量线外的新挑战者只算未入选，不制造出局历史", () => {
    const existing = item("KEEP.US", 7);
    const newcomer = item("WEAK.US", 3);
    const result = chooseCapacityRemovals([existing, newcomer], 1, new Set([existing.symbol]));
    expect(result.removedExisting).toEqual([]);
    expect(result.rejectedNew.map((x) => x.symbol)).toEqual(["WEAK.US"]);
  });

  it("更强的新挑战者可以替换低确信度旧观察项", () => {
    const existing = item("OLD.US", 3);
    const newcomer = item("NEW.US", 8);
    const result = chooseCapacityRemovals([existing, newcomer], 1, new Set([existing.symbol]));
    expect(result.removedExisting.map((x) => x.symbol)).toEqual(["OLD.US"]);
  });
});

describe("rotationExitPrice", () => {
  it("容量轮换使用最新行情，而不是入选价", () => {
    expect(rotationExitPrice(item("A.US", 5))).toBe(92);
  });
});
