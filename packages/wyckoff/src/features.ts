import { computeBarFeatures, pickNotableBars } from "./bars.js";
import { atr as computeAtr, lastFinite, mean, normalizedSlope, sma } from "./indicators.js";
import { detectTradingRanges } from "./ranges.js";
import { detectSwings } from "./swings.js";
import {
  DEFAULT_FEATURE_OPTIONS,
  FEATURE_ENGINE_VERSION,
  FEATURE_THRESHOLDS,
  type FeatureOptions,
  type Kline,
  type MarketFeatures,
  type RelativeStrength,
  type TrendSummary,
} from "./types.js";

export interface ComputeFeaturesInput {
  symbol: string;
  period: string;
  klines: Kline[];
  options?: FeatureOptions;
}

/**
 * 把原始 OHLCV 压缩成 Agent 能直接推理的结构化特征。
 *
 * 分工是刻意的：所有数值计算（哪里是摆动点、哪段是横盘、哪根量能异常）在这里
 * 用确定性算法算完，LLM 只负责判读与命名（这是 SC 还是 ST、区间处于哪个阶段）。
 * 既避免了模型数 K 线出错，也把上下文从几千行 OHLCV 压到几十行摘要。
 */
export function computeFeatures({ symbol, period, klines, options }: ComputeFeaturesInput): MarketFeatures {
  const opts = { ...DEFAULT_FEATURE_OPTIONS, ...options };
  const n = klines.length;

  if (n === 0) {
    return emptyFeatures(symbol, period);
  }

  const closes = klines.map((b) => b.close);
  const volumes = klines.map((b) => b.volume);
  const barFeatures = computeBarFeatures(klines, opts.lookback);
  const swings = detectSwings(klines, opts.swingAtrMultiple, opts.atrPeriod);
  const tradingRanges = detectTradingRanges(klines, barFeatures, {
    minBars: opts.minRangeBars,
    maxEfficiency: opts.maxRangeEfficiency,
    atrPeriod: opts.atrPeriod,
  });
  const notableBars = pickNotableBars(klines, barFeatures, opts.maxNotableBars);

  const atrValues = computeAtr(klines, opts.atrPeriod);
  const currentAtr = lastFinite(atrValues);
  const last = klines[n - 1];
  const first = klines[0];
  const recentClose = klines[Math.max(0, n - 60)].close;

  const recentVolume = mean(volumes.slice(Math.max(0, n - 10)));
  const overallVolume = mean(volumes);
  // recentRatio 的基准不含最近 10 根：短图上最近 10 根占整体均值的比重很大，
  // 自包含会让量比永远接近 1，看不出放量/缩量。
  const baselineVolume = n > 10 ? mean(volumes.slice(0, n - 10)) : recentVolume;

  return {
    engine: { version: FEATURE_ENGINE_VERSION, options: opts, thresholds: FEATURE_THRESHOLDS },
    symbol,
    period,
    barCount: n,
    startTime: first.timestamp,
    endTime: last.timestamp,
    price: {
      first: first.close,
      last: last.close,
      min: Math.min(...klines.map((b) => b.low)),
      max: Math.max(...klines.map((b) => b.high)),
      changePct: first.close !== 0 ? round(((last.close - first.close) / first.close) * 100, 2) : 0,
      recentChangePct: recentClose !== 0 ? round(((last.close - recentClose) / recentClose) * 100, 2) : 0,
    },
    atr: {
      current: round(currentAtr, 4),
      currentPct: last.close !== 0 ? round((currentAtr / last.close) * 100, 2) : 0,
    },
    volume: {
      mean: Math.round(overallVolume),
      last: last.volume,
      recentRatio: baselineVolume > 0 ? round(recentVolume / baselineVolume, 2) : 1,
    },
    trend: summarizeTrend(closes),
    swings,
    tradingRanges,
    notableBars,
  };
}

/**
 * 相对强度：Wyckoff 选股的关键一环——吸筹结束后率先走强的标的最值得跟。
 * 用超额收益（标的涨跌幅减基准涨跌幅）表达，比价格比值更直观。
 */
export function computeRelativeStrength(
  klines: Kline[],
  benchmarkKlines: Kline[],
  benchmarkSymbol: string,
  lookbackBars = 60,
): RelativeStrength | undefined {
  if (klines.length < 2 || benchmarkKlines.length < 2) return undefined;

  // 按时间戳对齐，避免两个市场交易日不一致导致的错位。
  const benchByTime = new Map(benchmarkKlines.map((b) => [b.timestamp, b.close]));
  const aligned = klines.filter((b) => benchByTime.has(b.timestamp));
  if (aligned.length < 2) return undefined;

  const window = aligned.slice(Math.max(0, aligned.length - lookbackBars));
  const startBar = window[0];
  const endBar = window[window.length - 1];
  const startBench = benchByTime.get(startBar.timestamp);
  const endBench = benchByTime.get(endBar.timestamp);
  if (startBench === undefined || endBench === undefined || startBench === 0 || startBar.close === 0) {
    return undefined;
  }

  const assetReturn = ((endBar.close - startBar.close) / startBar.close) * 100;
  const benchReturn = ((endBench - startBench) / startBench) * 100;
  const excess = assetReturn - benchReturn;

  return {
    benchmark: benchmarkSymbol,
    excessReturnPct: round(excess, 2),
    outperforming: excess > 0,
    lookbackBars: window.length,
  };
}

function summarizeTrend(closes: number[]): TrendSummary {
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ma200 = sma(closes, 200);

  const classify = (series: number[], window: number): TrendSummary["shortTerm"] => {
    const tail = series.slice(-window).filter(Number.isFinite);
    if (tail.length < 2) return "flat";
    const slope = normalizedSlope(tail);
    const currentMa = lastFinite(series);
    const currentClose = closes[closes.length - 1];
    if (slope > 0.08 && currentClose >= currentMa) return "up";
    if (slope < -0.08 && currentClose <= currentMa) return "down";
    return "flat";
  };

  return {
    shortTerm: classify(ma20, 10),
    mediumTerm: classify(ma50, 20),
    longTerm: classify(ma200, 40),
    ma20: round(lastFinite(ma20), 4),
    ma50: round(lastFinite(ma50), 4),
    ma200: round(lastFinite(ma200), 4),
  };
}

function emptyFeatures(symbol: string, period: string): MarketFeatures {
  return {
    engine: {
      version: FEATURE_ENGINE_VERSION,
      options: DEFAULT_FEATURE_OPTIONS,
      thresholds: FEATURE_THRESHOLDS,
    },
    symbol,
    period,
    barCount: 0,
    startTime: 0,
    endTime: 0,
    price: { first: 0, last: 0, min: 0, max: 0, changePct: 0, recentChangePct: 0 },
    atr: { current: 0, currentPct: 0 },
    volume: { mean: 0, last: 0, recentRatio: 1 },
    trend: { shortTerm: "flat", mediumTerm: "flat", longTerm: "flat", ma20: NaN, ma50: NaN, ma200: NaN },
    swings: [],
    tradingRanges: [],
    notableBars: [],
  };
}

function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
