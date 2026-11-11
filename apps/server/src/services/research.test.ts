import { describe, expect, it } from "vitest";
import type { MarketFeatures } from "@wyckoff/wyckoff";
import type { Kline } from "@wyckoff/shared";
import { computeStrategy } from "./research.js";
import { parseSecFundamentals, parseTencentQuote } from "./researchData.js";

function kline(close: number, high = close + 1, low = close - 1): Kline {
  return { timestamp: 1, open: close, high, low, close, volume: 1000, amount: 0 };
}

function features(overrides: Partial<Pick<MarketFeatures, "atr" | "trend" | "swings" | "tradingRanges">> = {}) {
  return {
    atr: { current: 2, currentPct: 2 },
    trend: { shortTerm: "up", mediumTerm: "up", longTerm: "up", ma20: 100, ma50: 98, ma200: 90 },
    swings: [
      { index: 0, timestamp: 1, price: 95, type: "low", changePct: 0, bars: 4 },
      { index: 1, timestamp: 2, price: 105, type: "high", changePct: 0, bars: 4 },
    ],
    tradingRanges: [],
    ...overrides,
  } as Parameters<typeof computeStrategy>[0];
}

describe("deterministic research strategy", () => {
  it("builds a long pullback plan inside a range with ordered levels", () => {
    const plan = computeStrategy(
      features({
        tradingRanges: [
          {
            startIndex: 0,
            endIndex: 19,
            startTime: 1,
            endTime: 20,
            bars: 20,
            support: 100,
            resistance: 110,
            heightPct: 10,
            efficiencyRatio: 0.2,
            touchesTop: 3,
            touchesBottom: 3,
            volumeVsBefore: 1,
            priorTrend: "down",
            hypothesis: "accumulation",
            pierces: [],
            atrAtRange: 2,
          },
        ],
      }),
      [kline(100), kline(105)],
    );
    expect(plan.bias).toBe("long");
    expect(plan.trigger.kind).toBe("hold");
    expect(plan.entryLow).toBeLessThan(plan.entryHigh!);
    expect(plan.stop).toBeLessThan(plan.entryLow!);
    expect(plan.target1).toBeGreaterThan(plan.entryHigh!);
    expect(plan.target2).toBeGreaterThan(plan.target1!);
    expect(plan.riskReward).toBeGreaterThan(0);
  });

  it("uses the broken swing high as a pullback trigger when price has left an old base", () => {
    const plan = computeStrategy(features(), [kline(120), kline(121)]);
    expect(plan.bias).toBe("long");
    // No range is active; 105 flipped from resistance to support.
    expect(plan.trigger.kind).toBe("reclaim");
    expect(plan.trigger.price).toBe(105);
    expect(plan.stop).toBeLessThan(plan.entryLow!);
  });
});

describe("research data parsers", () => {
  it("parses Tencent US valuation fields without mixing currencies", () => {
    const fields = Array(50).fill("0");
    fields[1] = "苹果";
    fields[30] = "2026-11-10 16:00:02";
    fields[35] = "USD";
    fields[39] = "38.81";
    fields[43] = "2.11";
    fields[44] = "50614.49";
    fields[46] = "Apple Inc.";
    fields[48] = "355.38";
    fields[49] = "242.76";
    const quote = parseTencentQuote(`v_usAAPL="${fields.join("~")}"`, {
      symbol: "AAPL.US",
      exchange: "US",
      code: "AAPL",
      name: "苹果",
      region: "US",
      type: "stock",
    });
    expect(quote).toMatchObject({
      currency: "USD",
      pe: 38.81,
      pb: 2.11,
      marketCap: 5_061_449_000_000,
      week52High: 355.38,
      week52Low: 242.76,
      englishName: "Apple Inc.",
    });
  });

  it("extracts annual SEC facts and computes the fiscal year", () => {
    const facts = {
      "us-gaap": {
        Revenues: {
          units: {
            USD: [
              { end: "2025-09-27", val: 1000, form: "10-K", fp: "FY" },
              { end: "2024-09-28", val: 900, form: "10-K", fp: "FY" },
            ],
          },
        },
        NetIncomeLoss: { units: { USD: [{ end: "2025-09-27", val: 200, form: "10-K", fp: "FY" }] } },
        GrossProfit: { units: { USD: [{ end: "2025-09-27", val: 400, form: "10-K", fp: "FY" }] } },
        StockholdersEquity: { units: { USD: [{ end: "2025-09-27", val: 500, form: "10-K", fp: "FY" }] } },
        EarningsPerShareDiluted: {
          units: { "USD/shares": [{ end: "2025-09-27", val: 2.5, form: "10-K", fp: "FY" }] },
        },
      },
      dei: {
        EntityCommonStockSharesOutstanding: {
          units: { shares: [{ end: "2025-09-27", val: 1000, form: "10-K", fp: "FY" }] },
        },
      },
    };
    const result = parseSecFundamentals(facts, "Example Inc.");
    expect(result).toMatchObject({
      companyName: "Example Inc.",
      revenue: 1000,
      netIncome: 200,
      grossProfit: 400,
      eps: 2.5,
      equity: 500,
      sharesOutstanding: 1000,
      fiscalYear: "2025",
    });
  });
});
