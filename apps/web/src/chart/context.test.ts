import { describe, expect, it } from "vitest";
import { chartContextKey } from "./context.js";

describe("chart context isolation", () => {
  const context = { symbol: "AAPL.US", period: "day", adjust: "forward", timeSpan: "1y", chartRevision: 1 };
  it.each(["symbol", "period", "adjust", "timeSpan", "chartRevision"] as const)("replaces the chart when %s changes", (field) => {
    expect(chartContextKey({ ...context, [field]: "changed" })).not.toBe(chartContextKey(context));
  });
  it("isolates an A/B/A switch even when the symbol returns to A", () => {
    expect(chartContextKey({ ...context, chartRevision: 3 })).not.toBe(chartContextKey(context));
  });
});
