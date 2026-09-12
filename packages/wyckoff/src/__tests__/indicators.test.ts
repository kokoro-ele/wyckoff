import { describe, expect, it } from "vitest";
import { atr, efficiencyRatio, ema, normalizedSlope, percentile, sma, trueRange } from "../indicators.js";
import { fromCloses, makeKline } from "./fixtures.js";

describe("sma", () => {
  it("前 period-1 项为 NaN，之后是滚动均值", () => {
    const out = sma([1, 2, 3, 4, 5], 3);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeNaN();
    expect(out[2]).toBe(2);
    expect(out[3]).toBe(3);
    expect(out[4]).toBe(4);
  });

  it("数据不足时全部为 NaN", () => {
    expect(sma([1, 2], 5).every(Number.isNaN)).toBe(true);
  });
});

describe("ema", () => {
  it("以 SMA 作为种子，并向最新值收敛", () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out[2]).toBe(2);
    expect(out[4]).toBeGreaterThan(out[3]);
    expect(out[4]).toBeLessThan(5);
  });
});

describe("trueRange", () => {
  it("跳空时取到前收盘的距离，而不是当根高低差", () => {
    const klines = [makeKline(0, 10, 11, 9, 10, 100), makeKline(1, 20, 21, 19, 20, 100)];
    const tr = trueRange(klines);
    expect(tr[0]).toBe(2);
    // 第二根跳空到 19~21，相对前收 10 的最大距离是 11
    expect(tr[1]).toBe(11);
  });
});

describe("atr", () => {
  it("恒定波幅下 ATR 等于该波幅", () => {
    const klines = Array.from({ length: 30 }, (_, i) => makeKline(i, 100, 102, 98, 100, 1000));
    const out = atr(klines, 14);
    expect(out[13]).toBeCloseTo(4, 6);
    expect(out[29]).toBeCloseTo(4, 6);
  });
});

describe("efficiencyRatio", () => {
  it("单边序列接近 1", () => {
    expect(efficiencyRatio([1, 2, 3, 4, 5])).toBeCloseTo(1, 6);
  });

  it("来回震荡接近 0", () => {
    expect(efficiencyRatio([1, 2, 1, 2, 1])).toBeCloseTo(0, 6);
  });
});

describe("normalizedSlope", () => {
  it("上升序列为正、下降序列为负", () => {
    expect(normalizedSlope([1, 2, 3, 4])).toBeGreaterThan(0);
    expect(normalizedSlope([4, 3, 2, 1])).toBeLessThan(0);
    expect(normalizedSlope([2, 2, 2, 2])).toBe(0);
  });
});

describe("percentile", () => {
  it("按线性插值取分位", () => {
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4, 5], 1)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
});

describe("fromCloses", () => {
  it("生成的 K 线高低价包住开收盘", () => {
    for (const bar of fromCloses([10, 11, 9])) {
      expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
      expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
    }
  });
});
