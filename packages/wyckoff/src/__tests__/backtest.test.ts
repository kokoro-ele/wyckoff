import { describe, expect, it } from "vitest";
import type { BacktestRequestInput, BacktestStrategy, Kline } from "@wyckoff/shared";
import { BacktestInputError, runBacktest } from "../backtest.js";

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);

function bar(index: number, close: number, options: Partial<Omit<Kline, "timestamp" | "close">> = {}): Kline {
  const open = options.open ?? close;
  return {
    timestamp: START + index * DAY,
    open,
    high: options.high ?? Math.max(open, close) + 1,
    low: options.low ?? Math.min(open, close) - 1,
    close,
    volume: options.volume ?? 100,
    amount: options.amount ?? close * (options.volume ?? 100),
  };
}

function request(
  strategy: BacktestStrategy,
  overrides: Partial<Omit<BacktestRequestInput, "symbol" | "strategy">> = {},
): BacktestRequestInput {
  return {
    symbol: "TEST.US",
    period: "1d",
    adjust: "none",
    initialCapital: 100_000,
    positionSizePct: 100,
    commissionBps: 0,
    slippageBps: 0,
    stopLossPct: 50,
    takeProfitPct: 200,
    maxHoldingBars: 100,
    strategy,
    ...overrides,
  };
}

function maBars(): Kline[] {
  const closes = [103, 102, 101, 102, 104, 104, 101, 100];
  const opens = [103, 103, 102, 101, 102, 105, 104, 99];
  return closes.map((close, index) => bar(index, close, { open: opens[index] }));
}

function rangeBars(withBreakout = true): Kline[] {
  const bars = Array.from({ length: 10 }, (_, index) => bar(index, index % 2 === 0 ? 99 : 101));
  bars.push(bar(10, withBreakout ? 104 : 101, { open: 101, high: withBreakout ? 105 : 102, low: 100, volume: 200 }));
  bars.push(bar(11, 101, { open: 105, high: 106, low: 100, volume: 120 }));
  bars.push(bar(12, 100, { open: 100, high: 102, low: 99, volume: 100 }));
  return bars;
}

describe("runBacktest · 成交与账本", () => {
  it("在信号的下一根开盘成交，并把双向不利滑点和双边佣金计入交易", () => {
    const bars = maBars();
    const result = runBacktest({
      id: "cost-case",
      createdAt: 123,
      klines: bars,
      request: request(
        { type: "ma_cross", fastPeriod: 2, slowPeriod: 3 },
        { commissionBps: 10, slippageBps: 20 },
      ),
    });

    expect(result.id).toBe("cost-case");
    expect(result.createdAt).toBe(123);
    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    expect(trade.entrySignalTime).toBe(bars[4].timestamp);
    expect(trade.entryTime).toBe(bars[5].timestamp);
    expect(trade.entryPrice).toBeCloseTo(bars[5].open * 1.002, 6);
    expect(trade.exitSignalTime).toBe(bars[6].timestamp);
    expect(trade.exitTime).toBe(bars[7].timestamp);
    expect(trade.exitPrice).toBeCloseTo(bars[7].open * 0.998, 6);
    expect(trade.exitReason).toBe("strategy_signal");
    expect(trade.fees).toBeGreaterThan(0);
    expect(result.metrics.totalFees).toBeCloseTo(trade.fees, 2);
    expect(trade.netPnl).toBeLessThan(trade.grossPnl);
  });

  it("开仓当根同时触及止损和止盈时保守地按止损成交", () => {
    const bars = maBars().slice(0, 6);
    bars[5] = bar(5, 104, { open: 105, high: 130, low: 90 });
    const result = runBacktest({
      klines: bars,
      request: request(
        { type: "ma_cross", fastPeriod: 2, slowPeriod: 3 },
        { stopLossPct: 10, takeProfitPct: 10 },
      ),
    });

    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    expect(trade.entryTime).toBe(bars[5].timestamp);
    expect(trade.exitTime).toBe(bars[5].timestamp);
    expect(trade.exitReason).toBe("stop_loss");
    expect(trade.exitPrice).toBeCloseTo(94.5, 6);
    expect(trade.exitReasonText).toContain("同时触及");
    expect(result.metrics.maxDrawdownPct).toBeGreaterThan(0);
    expect(Math.min(...result.curve.map((point) => point.drawdownPct))).toBeLessThan(0);
  });

  it("沪深京股票遵守 T+1，买入当根即使触发价格也不能卖出", () => {
    const bars = maBars();
    bars[5] = bar(5, 104, { open: 105, high: 130, low: 90 });
    const result = runBacktest({
      klines: bars,
      request: {
        ...request(
          { type: "ma_cross", fastPeriod: 2, slowPeriod: 3 },
          { stopLossPct: 10, takeProfitPct: 10 },
        ),
        symbol: "600519.SH",
      },
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].entryTime).toBe(bars[5].timestamp);
    expect(result.trades[0].exitTime).not.toBe(bars[5].timestamp);
    expect(result.warnings.some((warning) => warning.includes("T+1"))).toBe(true);
  });

  it("最后仍有持仓时按末根收盘结算并明确标记例外", () => {
    const bars = maBars().slice(0, 6);
    const result = runBacktest({
      klines: bars,
      request: request({ type: "ma_cross", fastPeriod: 2, slowPeriod: 3 }),
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("end_of_data");
    expect(result.trades[0].exitSignalTime).toBeNull();
    expect(result.warnings.some((warning) => warning.includes("不是次根开盘"))).toBe(true);
  });
});

describe("runBacktest · 预热与无未来函数", () => {
  it("使用 startTime 前的数据预热，但曲线、基准和成交都从 startTime 开始", () => {
    const bars = maBars();
    const result = runBacktest({
      klines: bars,
      request: request(
        { type: "ma_cross", fastPeriod: 2, slowPeriod: 3 },
        { startTime: bars[4].timestamp },
      ),
    });

    expect(result.data.barCount).toBe(4);
    expect(result.data.startTime).toBe(bars[4].timestamp);
    expect(result.data.actualWarmupBars).toBe(3);
    expect(result.curve[0].timestamp).toBe(bars[4].timestamp);
    expect(result.curve[0].benchmarkEquity).toBe(100_000);
    expect(result.trades[0].entrySignalTime).toBe(bars[4].timestamp);
    expect(result.trades[0].entryTime).toBe(bars[5].timestamp);
  });

  it("预热历史不足时明确告警，并在指标有效前保持空仓", () => {
    const bars = maBars();
    const result = runBacktest({
      klines: bars,
      request: request(
        { type: "ma_cross", fastPeriod: 2, slowPeriod: 3 },
        { startTime: bars[1].timestamp },
      ),
    });

    expect(result.data.actualWarmupBars).toBe(1);
    expect(result.data.warmupBars).toBe(3);
    expect(result.warnings.some((warning) => warning.includes("仅取得 1 根预热"))).toBe(true);
    expect(result.trades.every((trade) => trade.entrySignalTime >= bars[3].timestamp)).toBe(true);
  });

  it("按首末时间戳计算 CAGR，而不是假定固定交易日数量", () => {
    const bars = maBars().map((item, index) => ({
      ...item,
      timestamp: START + index * 52 * DAY,
    }));
    const result = runBacktest({
      klines: bars,
      request: request({ type: "ma_cross", fastPeriod: 2, slowPeriod: 3 }),
    });
    const years = (bars.at(-1)!.timestamp - bars[0].timestamp) / (365.2425 * DAY);
    const expected = ((1 + result.metrics.totalReturnPct / 100) ** (1 / years) - 1) * 100;

    expect(result.metrics.annualizedReturnPct).toBeCloseTo(expected, 3);
  });

  it("短于 30 个自然日时不伪造年化指标", () => {
    const result = runBacktest({
      klines: maBars(),
      request: request({ type: "ma_cross", fastPeriod: 2, slowPeriod: 3 }),
    });

    expect(result.metrics.annualizedReturnPct).toBeNull();
    expect(result.metrics.annualizedVolatilityPct).toBeNull();
    expect(result.metrics.sharpeRatio).toBeNull();
    expect(result.warnings.some((warning) => warning.includes("不足约 3 个月"))).toBe(true);
  });

  it("输出包含覆盖实际计算窗口的稳定行情指纹", () => {
    const result = runBacktest({
      klines: maBars(),
      request: request({ type: "ma_cross", fastPeriod: 2, slowPeriod: 3 }),
    });
    const repeated = runBacktest({
      klines: maBars(),
      request: request({ type: "ma_cross", fastPeriod: 2, slowPeriod: 3 }),
    });

    expect(result.data.fingerprint).toMatch(/^ohlcv-v1:[0-9a-f]{16}$/);
    expect(repeated.data.fingerprint).toBe(result.data.fingerprint);
  });

  it("最后一根才出现的信号不会用该根收盘价偷跑成交", () => {
    const bars = maBars().slice(0, 5);
    const result = runBacktest({
      klines: bars,
      request: request({ type: "ma_cross", fastPeriod: 2, slowPeriod: 3 }),
    });

    expect(result.trades).toHaveLength(0);
    expect(result.warnings.some((warning) => warning.includes("没有下一根开盘"))).toBe(true);
  });

  it("追加未来 K 线不会改写已经完成的 Wyckoff 交易", () => {
    const base = rangeBars();
    const strategy: BacktestStrategy = {
      type: "wyckoff_breakout",
      rangeLookback: 10,
      maxRangeEfficiency: 0.35,
      breakoutBufferPct: 0.3,
      volumeLookback: 5,
      volumeMultiplier: 1.2,
    };
    const before = runBacktest({ id: "before", createdAt: 1, klines: base, request: request(strategy) });
    const extended = [
      ...base,
      bar(13, 180, { open: 180, high: 190, low: 170, volume: 10_000 }),
      bar(14, 50, { open: 50, high: 60, low: 40, volume: 20_000 }),
    ];
    const after = runBacktest({ id: "after", createdAt: 2, klines: extended, request: request(strategy) });

    expect(before.trades).toHaveLength(1);
    expect(after.trades.length).toBeGreaterThanOrEqual(1);
    expect(after.trades[0]).toMatchObject({
      entrySignalTime: before.trades[0].entrySignalTime,
      entryTime: before.trades[0].entryTime,
      entryPrice: before.trades[0].entryPrice,
      exitSignalTime: before.trades[0].exitSignalTime,
      exitTime: before.trades[0].exitTime,
      exitPrice: before.trades[0].exitPrice,
      exitReason: before.trades[0].exitReason,
    });
  });
});

describe("runBacktest · 策略", () => {
  it("MA 快线上穿入场、下穿退出", () => {
    const result = runBacktest({
      klines: maBars(),
      request: request({ type: "ma_cross", fastPeriod: 2, slowPeriod: 3 }),
    });
    expect(result.strategyName).toContain("均线");
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].entryReason).toContain("上穿");
    expect(result.trades[0].exitReasonText).toContain("下穿");
  });

  it("Wyckoff 策略只用当前 K 线之前的低效率区间与历史均量判断突破", () => {
    const bars = rangeBars();
    const result = runBacktest({
      klines: bars,
      request: request({
        type: "wyckoff_breakout",
        rangeLookback: 10,
        maxRangeEfficiency: 0.35,
        breakoutBufferPct: 0.3,
        volumeLookback: 5,
        volumeMultiplier: 1.2,
      }),
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].entrySignalTime).toBe(bars[10].timestamp);
    expect(result.trades[0].entryTime).toBe(bars[11].timestamp);
    expect(result.trades[0].entryReason).toContain("区间效率比");
    expect(result.trades[0].exitSignalTime).toBe(bars[11].timestamp);
    expect(result.trades[0].exitTime).toBe(bars[12].timestamp);
  });

  it("拒绝把单边趋势误当成 Wyckoff 横盘突破", () => {
    const bars = Array.from({ length: 10 }, (_, index) => bar(index, 90 + index));
    bars.push(bar(10, 105, { volume: 500 }));
    bars.push(bar(11, 106));
    const result = runBacktest({
      klines: bars,
      request: request({
        type: "wyckoff_breakout",
        rangeLookback: 10,
        maxRangeEfficiency: 0.35,
        breakoutBufferPct: 0,
        volumeLookback: 5,
        volumeMultiplier: 1.2,
      }),
    });
    expect(result.trades).toHaveLength(0);
  });
});

describe("runBacktest · 输入边界", () => {
  it("拒绝乱序 K 线，而不是静默排序", () => {
    const bars = maBars();
    [bars[2], bars[3]] = [bars[3], bars[2]];
    expect(() =>
      runBacktest({ klines: bars, request: request({ type: "ma_cross", fastPeriod: 2, slowPeriod: 3 }) }),
    ).toThrowError(BacktestInputError);
    try {
      runBacktest({ klines: bars, request: request({ type: "ma_cross", fastPeriod: 2, slowPeriod: 3 }) });
    } catch (error) {
      expect((error as BacktestInputError).code).toBe("INVALID_DATA");
    }
  });

  it("数据不足策略预热时抛出可识别错误", () => {
    expect(() =>
      runBacktest({
        klines: maBars().slice(0, 3),
        request: request({ type: "ma_cross", fastPeriod: 2, slowPeriod: 3 }),
      }),
    ).toThrowError(expect.objectContaining({ code: "INSUFFICIENT_DATA" }));
  });

  it("拒绝无法序列化的行情与溢出结果", () => {
    const invalidAmount = maBars();
    invalidAmount[0] = { ...invalidAmount[0], amount: Number.POSITIVE_INFINITY };
    expect(() =>
      runBacktest({
        klines: invalidAmount,
        request: request({ type: "ma_cross", fastPeriod: 2, slowPeriod: 3 }),
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_DATA" }));

    const explosive = [1e-308, 1e-308, 1e-308, 1e308].map((price, index): Kline => ({
      timestamp: START + index * 10 * DAY,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 1,
      amount: 0,
    }));
    expect(() =>
      runBacktest({
        klines: explosive,
        request: request({ type: "ma_cross", fastPeriod: 2, slowPeriod: 3 }),
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_DATA" }));
  });
});
