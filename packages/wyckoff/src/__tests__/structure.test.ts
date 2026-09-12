import { describe, expect, it } from "vitest";
import { computeBarFeatures, pickNotableBars } from "../bars.js";
import { computeFeatures, computeRelativeStrength } from "../features.js";
import { detectTradingRanges } from "../ranges.js";
import { nearestIndex, renderFeatureSummary, summarizeSelectedBar, summarizeSelectedRange } from "../summary.js";
import { detectSwings } from "../swings.js";
import { atr } from "../indicators.js";
import { accumulationFixture, fromCloses, makeKline, SPRING_INDEX } from "./fixtures.js";

describe("detectSwings", () => {
  it("在单边趋势里不产生来回摆动", () => {
    const klines = fromCloses(Array.from({ length: 60 }, (_, i) => 100 + i));
    const swings = detectSwings(klines);
    // 全程上涨，最多只有起点低点和终点高点
    expect(swings.length).toBeLessThanOrEqual(2);
    if (swings.length === 2) {
      expect(swings[0].type).toBe("low");
      expect(swings[1].type).toBe("high");
    }
  });

  it("高低点交替出现，且高点价格高于相邻低点", () => {
    const swings = detectSwings(accumulationFixture());
    expect(swings.length).toBeGreaterThan(2);
    for (let i = 1; i < swings.length; i++) {
      expect(swings[i].type).not.toBe(swings[i - 1].type);
      expect(swings[i].index).toBeGreaterThan(swings[i - 1].index);
    }
    for (let i = 1; i < swings.length; i++) {
      const [a, b] = [swings[i - 1], swings[i]];
      const [high, low] = a.type === "high" ? [a, b] : [b, a];
      expect(high.price).toBeGreaterThan(low.price);
    }
  });

  it("数据太短时返回空数组", () => {
    expect(detectSwings(fromCloses([1, 2]))).toEqual([]);
  });
});

describe("computeBarFeatures", () => {
  it("量比以之前若干根为基准，突增的那根量比显著大于 1", () => {
    const volumes = Array.from({ length: 40 }, (_, i) => (i === 30 ? 5_000_000 : 1_000_000));
    const klines = fromCloses(Array.from({ length: 40 }, () => 100), volumes);
    const features = computeBarFeatures(klines, 20);
    expect(features[30].volumeRatio).toBeCloseTo(5, 1);
    expect(features[30].isClimacticVolume).toBe(true);
    expect(features[29].isClimacticVolume).toBe(false);
  });

  it("收盘位置反映收在高位还是低位", () => {
    const klines = [
      makeKline(0, 100, 100, 100, 100, 1000),
      makeKline(1, 95, 100, 90, 99, 1000),
      makeKline(2, 95, 100, 90, 91, 1000),
    ];
    const features = computeBarFeatures(klines, 5);
    expect(features[1].closePosition).toBeCloseTo(0.9, 2);
    expect(features[2].closePosition).toBeCloseTo(0.1, 2);
  });

  it("放巨量却收窄幅判定为努力与结果背离", () => {
    const klines = Array.from({ length: 30 }, (_, i) => makeKline(i, 100, 104, 96, 100, 1_000_000));
    klines.push(makeKline(30, 100, 100.5, 99.5, 100, 5_000_000));
    const features = computeBarFeatures(klines, 20);
    expect(features[30].effortVsResult).toBe("no_result");
  });
});

describe("pickNotableBars", () => {
  it("挑出的 K 线都带有理由，且按时间排序", () => {
    const klines = accumulationFixture();
    const notable = pickNotableBars(klines, computeBarFeatures(klines), 20);
    expect(notable.length).toBeGreaterThan(0);
    expect(notable.length).toBeLessThanOrEqual(20);
    for (const bar of notable) expect(bar.reasons.length).toBeGreaterThan(0);
    for (let i = 1; i < notable.length; i++) {
      expect(notable[i].index).toBeGreaterThan(notable[i - 1].index);
    }
  });
});

describe("detectTradingRanges", () => {
  const analyze = (klines: ReturnType<typeof accumulationFixture>) =>
    detectTradingRanges(klines, computeBarFeatures(klines));

  it("在单边趋势中不误判出横盘区间", () => {
    expect(analyze(fromCloses(Array.from({ length: 120 }, (_, i) => 100 + i * 1.5)))).toHaveLength(0);
  });

  it("在 V 形反转中不误判——净位移虽小但高低点根本不成簇", () => {
    const down = Array.from({ length: 60 }, (_, i) => 100 - i * 0.7);
    const up = Array.from({ length: 60 }, (_, i) => 58 + i * 0.7);
    expect(analyze(fromCloses([...down, ...up]))).toHaveLength(0);
  });

  it("识别出吸筹横盘区间，并把它定性为潜在吸筹", () => {
    const klines = accumulationFixture();
    const ranges = analyze(klines);
    expect(ranges.length).toBeGreaterThan(0);

    // 横盘发生在第 47 ~ 99 根之间，突破从第 100 根开始
    const main = ranges.find((r) => r.startIndex <= 60 && r.endIndex >= 90);
    expect(main).toBeDefined();
    expect(main!.hypothesis).toBe("accumulation");
    expect(main!.priorTrend).toBe("down");
    expect(main!.support).toBeLessThan(main!.resistance);
    const localAtr = atr(klines, 14)
      .slice(main!.startIndex, main!.endIndex + 1)
      .filter(Number.isFinite);
    const expectedAtr = localAtr.reduce((sum, value) => sum + value, 0) / localAtr.length;
    expect(main!.atrAtRange).toBeCloseTo(expectedAtr, 3);
    // 关键：区间不应把后面的突破段吞进来
    expect(main!.endIndex).toBeLessThan(105);
  });

  it("把弹簧识别为向下穿刺且当根收回区间内", () => {
    const klines = accumulationFixture();
    const main = analyze(klines).find((r) => r.startIndex <= 60 && r.endIndex >= 90);
    const spring = main?.pierces.find((p) => p.side === "below" && p.index === SPRING_INDEX);
    expect(spring).toBeDefined();
    expect(spring!.recovered).toBe(true);
    expect(spring!.depthPct).toBeGreaterThan(0);
  });

  it("区间之间不重叠", () => {
    const ranges = analyze(accumulationFixture());
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i].startIndex).toBeGreaterThan(ranges[i - 1].endIndex);
    }
  });
});

describe("computeFeatures", () => {
  it("产出完整的结构摘要", () => {
    const klines = accumulationFixture();
    const f = computeFeatures({ symbol: "TEST.SH", period: "1d", klines });

    expect(f.barCount).toBe(klines.length);
    expect(f.startTime).toBe(klines[0].timestamp);
    expect(f.endTime).toBe(klines[klines.length - 1].timestamp);
    expect(f.price.max).toBeGreaterThan(f.price.min);
    expect(f.atr.current).toBeGreaterThan(0);
    expect(f.tradingRanges.length).toBeGreaterThan(0);
    expect(f.swings.length).toBeGreaterThan(0);
    expect(f.trend.shortTerm).toBe("up");
  });

  it("空数据不抛异常", () => {
    const f = computeFeatures({ symbol: "X.SH", period: "1d", klines: [] });
    expect(f.barCount).toBe(0);
    expect(f.tradingRanges).toEqual([]);
  });

  it("均线仍上扬但现价已经跌破均线时不再标记为上涨", () => {
    const closes = Array.from({ length: 220 }, (_, i) => 100 + i * 0.2);
    closes[closes.length - 1] = 80;
    const f = computeFeatures({ symbol: "X.SH", period: "1d", klines: fromCloses(closes) });
    expect(f.trend.shortTerm).not.toBe("up");
    expect(f.engine.version).toBeTruthy();
    expect(f.engine.thresholds.climaxVolumeRatio).toBeGreaterThan(1);
  });
});

describe("computeRelativeStrength", () => {
  it("跑赢基准时超额收益为正", () => {
    const asset = fromCloses(Array.from({ length: 80 }, (_, i) => 100 + i * 2));
    const bench = fromCloses(Array.from({ length: 80 }, (_, i) => 100 + i * 0.5));
    const rs = computeRelativeStrength(asset, bench, "000001.SH", 60);
    expect(rs).toBeDefined();
    expect(rs!.outperforming).toBe(true);
    expect(rs!.excessReturnPct).toBeGreaterThan(0);
  });

  it("时间戳完全对不上时返回 undefined", () => {
    const asset = fromCloses([1, 2, 3]);
    const bench = fromCloses([1, 2, 3]).map((b) => ({ ...b, timestamp: b.timestamp + 12_345 }));
    expect(computeRelativeStrength(asset, bench, "X", 60)).toBeUndefined();
  });
});

describe("nearestIndex", () => {
  const klines = fromCloses([1, 2, 3, 4, 5]);

  it("精确命中", () => {
    expect(nearestIndex(klines, klines[2].timestamp)).toBe(2);
  });

  it("吸附到最近的一根", () => {
    expect(nearestIndex(klines, klines[2].timestamp + 1000)).toBe(2);
    expect(nearestIndex(klines, klines[2].timestamp + 86_000_000)).toBe(3);
  });

  it("超出范围时吸附到端点", () => {
    expect(nearestIndex(klines, 0)).toBe(0);
    expect(nearestIndex(klines, Number.MAX_SAFE_INTEGER)).toBe(4);
  });
});

describe("摘要渲染", () => {
  const klines = accumulationFixture();

  it("整体摘要包含区间与异常 K 线小节", () => {
    const text = renderFeatureSummary(computeFeatures({ symbol: "TEST.SH", period: "1d", klines }));
    expect(text).toContain("TEST.SH");
    expect(text).toContain("横盘交易区间");
    expect(text).toContain("摆动高低点");
    expect(text).toContain("特征引擎 v");
    // 日期应渲染成 YYYY-MM-DD 而不是 13 位时间戳
    expect(text).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(text).not.toMatch(/1[6-9]\d{11}/);
  });

  it("框选摘要覆盖所选范围", () => {
    const text = summarizeSelectedRange(klines, "1d", klines[50].timestamp, klines[80].timestamp);
    expect(text).toContain("框选");
    expect(text).toContain("效率比");
  });

  it("单根 K 线摘要给出量价明细", () => {
    const text = summarizeSelectedBar(klines, "1d", klines[SPRING_INDEX].timestamp);
    expect(text).toContain("量比");
    expect(text).toContain("收盘位置");
    expect(text).toContain("← 选中");
  });
});
