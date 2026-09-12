import { atr as computeAtr, efficiencyRatio, mean } from "./indicators.js";
import { detectSwings } from "./swings.js";
import {
  FEATURE_THRESHOLDS,
  type BarFeature,
  type Kline,
  type RangePierce,
  type SwingPoint,
  type TradingRange,
} from "./types.js";

/**
 * 区间检测专用的 ZigZag 粒度，比摘要里展示的摆动点更细。
 * 区间内部的每一次上下测试幅度本来就小于区间高度，用展示级别的粗粒度会直接看不见它们。
 */
const RANGE_SWING_MULTIPLE = FEATURE_THRESHOLDS.rangeSwingAtrMultiple;

/** 高点簇（或低点簇）的最大离散度，占区间高度的比例。超过就说明它们不在同一条线上。 */
const CLUSTER_TOLERANCE = FEATURE_THRESHOLDS.clusterToleranceOfHeight;
/** 区间高度相对平均 ATR 的上下限，用来剔除过窄的平台和过宽的震荡。 */
const MIN_HEIGHT_ATR = FEATURE_THRESHOLDS.minRangeHeightAtr;
const MAX_HEIGHT_ATR = FEATURE_THRESHOLDS.maxRangeHeightAtr;
/** 判定为「穿刺」所需的最小深度，占区间高度的比例。 */
const MIN_PIERCE_DEPTH = FEATURE_THRESHOLDS.minPierceDepthOfHeight;
/** 触及上下沿的判定带宽，占区间高度的比例。 */
const TOUCH_BAND = FEATURE_THRESHOLDS.touchBandOfHeight;
/** 单个区间最多报告多少次穿刺，按显著性取前几名。 */
const MAX_PIERCES = 8;
/** 区间向两侧延伸的上限，占摆动点跨度的比例。防止宽区间沿着带子无限外扩。 */
const MAX_EXTEND_RATIO = 0.25;
/** 两个区间允许的最大重叠，占较短那个区间长度的比例。 */
const MAX_OVERLAP_RATIO = 0.2;

export interface RangeOptions {
  minBars?: number;
  maxEfficiency?: number;
  atrPeriod?: number;
  /** 聚簇所用摆动点的 ATR 倍数，越小识别到的区间内部结构越细。 */
  swingMultiple?: number;
}

interface ClusterBand {
  support: number;
  resistance: number;
  height: number;
}

/**
 * 交易区间检测：以摆动点聚簇为核心判据。
 *
 * 这正是人工判读交易区间的方式——看高点是不是反复顶在同一条阻力上、低点是不是
 * 反复踩在同一条支撑上。用它替代「效率比 + 滑窗扩张」那类纯统计做法，有三个好处：
 *
 * 1. 趋势段会被自然排除。下跌趋势里高点一路降低，根本聚不成簇。
 * 2. 区间的起止点落在真实的摆动点上，而不是滑窗贪心扩张出来的任意位置——
 *    后者总会把区间前后的趋势段一并吞进来。
 * 3. 允许高点簇和低点簇各有一个离群值，恰好对应 Wyckoff 的 Upthrust 与 Spring：
 *    它们本来就是「越出边界随即收回」的结构，不该因为自己越界就把区间给切断。
 */
export function detectTradingRanges(
  klines: Kline[],
  features: BarFeature[],
  options: RangeOptions = {},
): TradingRange[] {
  const { minBars = 20, maxEfficiency = 0.5, atrPeriod = 14, swingMultiple = RANGE_SWING_MULTIPLE } = options;
  if (klines.length < minBars) return [];

  const swings: SwingPoint[] = detectSwings(klines, swingMultiple, atrPeriod);
  if (swings.length < 4) return [];

  const atrValues = computeAtr(klines, atrPeriod);
  const closes = klines.map((b) => b.close);

  const ranges: TradingRange[] = [];
  let a = 0;

  while (a <= swings.length - 4) {
    let bestEnd = -1;
    let bestBand: ClusterBand | null = null;

    // 向后扫到尽头，只保留最后一段成立的窗口。
    // 簇性质在窗口扩张时不是单调的：高点数量达到 3 个后，极端高点可以被当作
    // Upthrust/Spring 离群值丢弃，离散度反而变小——中途某段不成簇不代表更长的
    // 窗口也不会成簇，所以这里不能一见失败就 break。
    for (let b = a + 3; b < swings.length; b++) {
      const band = clusterBand(swings.slice(a, b + 1));
      if (!band) continue;
      bestEnd = b;
      bestBand = band;
    }

    if (bestEnd < 0 || !bestBand) {
      a++;
      continue;
    }

    const range = buildRange(klines, features, closes, atrValues, swings[a].index, swings[bestEnd].index, bestBand);
    if (
      range &&
      range.bars >= minBars &&
      range.efficiencyRatio <= maxEfficiency &&
      bestBand.height >= MIN_HEIGHT_ATR * range.atrAtRange &&
      bestBand.height <= MAX_HEIGHT_ATR * range.atrAtRange
    ) {
      ranges.push(range);
      // 只有真正接受了区间才跳过其内部起点；被过滤的宽窗口不能遮住内部更短的有效区间。
      a = Math.max(bestEnd, a + 1);
    } else {
      a++;
    }
  }

  return dedupeOverlaps(ranges);
}

/**
 * 相邻窗口常常识别出彼此重叠的区间（同一段横盘的不同切法）。
 * 按「时间跨度 × 上下沿触及次数」的质量分贪心取舍，只留下互不重叠的一组，
 * 免得 Agent 拿到一堆讲的其实是同一件事的区间。
 */
function dedupeOverlaps(ranges: TradingRange[]): TradingRange[] {
  const quality = (r: TradingRange) => r.bars * (r.touchesTop + r.touchesBottom);
  const accepted: TradingRange[] = [];

  for (const range of [...ranges].sort((x, y) => quality(y) - quality(x))) {
    const clashes = accepted.some((kept) => {
      const overlap = Math.min(kept.endIndex, range.endIndex) - Math.max(kept.startIndex, range.startIndex) + 1;
      return overlap > MAX_OVERLAP_RATIO * Math.min(kept.bars, range.bars);
    });
    if (!clashes) accepted.push(range);
  }

  return accepted.sort((x, y) => x.startIndex - y.startIndex);
}

/**
 * 检查一组摆动点的高点与低点是否各自成簇，成簇则返回区间边界。
 *
 * 高点簇允许丢弃最高的那一个、低点簇允许丢弃最低的那一个，为 Upthrust 与 Spring 留出位置——
 * 但**离群点必须位于窗口内部**。这一条约束至关重要：落在窗口边缘的极值不是穿刺，
 * 而是区间的起点或终点。Spring 之所以是 Spring，正因为它之后价格又回到了区间里；
 * 少了这条约束，末端的突破段会被当成「上方离群点」一路吞掉，区间边界就失控了。
 */
function clusterBand(window: SwingPoint[]): ClusterBand | null {
  const highs = window.filter((s) => s.type === "high");
  const lows = window.filter((s) => s.type === "low");
  if (highs.length < 2 || lows.length < 2) return null;

  const first = window[0];
  const last = window[window.length - 1];
  const isInterior = (s: SwingPoint) => s !== first && s !== last;

  const extremeHigh = highs.reduce((a, b) => (b.price > a.price ? b : a));
  const extremeLow = lows.reduce((a, b) => (b.price < a.price ? b : a));

  const coreHighs = highs.length >= 3 && isInterior(extremeHigh) ? highs.filter((s) => s !== extremeHigh) : highs;
  const coreLows = lows.length >= 3 && isInterior(extremeLow) ? lows.filter((s) => s !== extremeLow) : lows;

  const highPrices = coreHighs.map((s) => s.price);
  const lowPrices = coreLows.map((s) => s.price);
  const resistance = Math.max(...highPrices);
  const support = Math.min(...lowPrices);
  const height = resistance - support;
  if (height <= 0) return null;

  const highSpread = resistance - Math.min(...highPrices);
  const lowSpread = Math.max(...lowPrices) - support;
  if (highSpread > CLUSTER_TOLERANCE * height || lowSpread > CLUSTER_TOLERANCE * height) return null;

  return { support, resistance, height };
}

function buildRange(
  klines: Kline[],
  features: BarFeature[],
  closes: number[],
  atrValues: number[],
  swingStart: number,
  swingEnd: number,
  band: ClusterBand,
): TradingRange | null {
  const { support, resistance, height } = band;

  // 摆动点只是骨架，把区间向两侧延伸到价格真正离开带子为止，画出来的矩形才贴合走势。
  // 延伸幅度必须封顶：宽区间的带子很容易一路兼容前后好几个月的价格，不封顶就会无限外扩。
  const maxExtend = Math.max(3, Math.round((swingEnd - swingStart) * MAX_EXTEND_RATIO));
  let start = swingStart;
  let end = swingEnd;
  const inBand = (i: number) => closes[i] >= support && closes[i] <= resistance;
  while (start > 0 && swingStart - start < maxExtend && inBand(start - 1)) start--;
  while (end < klines.length - 1 && end - swingEnd < maxExtend && inBand(end + 1)) end++;

  const slice = klines.slice(start, end + 1);
  if (slice.length === 0) return null;
  const rangeAtrValues = atrValues.slice(start, end + 1).filter(Number.isFinite);
  const rangeAtr =
    rangeAtrValues.length > 0 ? mean(rangeAtrValues) : mean(slice.map((bar) => Math.max(bar.high - bar.low, 0))) || 1;

  const allPierces: RangePierce[] = [];
  for (let k = start; k <= end; k++) {
    const bar = klines[k];
    const volumeRatio = features[k]?.volumeRatio ?? 1;
    if (bar.low < support - height * MIN_PIERCE_DEPTH) {
      allPierces.push({
        index: k,
        timestamp: bar.timestamp,
        side: "below",
        depthPct: round(((support - bar.low) / height) * 100, 1),
        recovered: bar.close > support,
        volumeRatio,
      });
    } else if (bar.high > resistance + height * MIN_PIERCE_DEPTH) {
      allPierces.push({
        index: k,
        timestamp: bar.timestamp,
        side: "above",
        depthPct: round(((bar.high - resistance) / height) * 100, 1),
        recovered: bar.close < resistance,
        volumeRatio,
      });
    }
  }

  // 只保留最显著的几次：深度与量能共同决定一次穿刺值不值得 Agent 去判读。
  const pierces = allPierces
    .slice()
    .sort((x, y) => y.depthPct * Math.max(y.volumeRatio, 1) - x.depthPct * Math.max(x.volumeRatio, 1))
    .slice(0, MAX_PIERCES)
    .sort((x, y) => x.index - y.index);

  const rangeVolume = mean(slice.map((b) => b.volume));
  const beforeStart = Math.max(0, start - slice.length);
  const beforeVolume = start > beforeStart ? mean(klines.slice(beforeStart, start).map((b) => b.volume)) : rangeVolume;

  const priorTrend = classifyPriorTrend(klines, start, slice.length, height);

  return {
    startIndex: start,
    endIndex: end,
    startTime: klines[start].timestamp,
    endTime: klines[end].timestamp,
    bars: slice.length,
    support: round(support, 4),
    resistance: round(resistance, 4),
    heightPct: round((height / ((support + resistance) / 2)) * 100, 2),
    efficiencyRatio: round(efficiencyRatio(closes.slice(start, end + 1)), 3),
    touchesTop: countTouches(slice.map((b) => b.high), resistance - height * TOUCH_BAND, "above"),
    touchesBottom: countTouches(slice.map((b) => b.low), support + height * TOUCH_BAND, "below"),
    volumeVsBefore: round(beforeVolume > 0 ? rangeVolume / beforeVolume : 1, 2),
    priorTrend,
    hypothesis: priorTrend === "down" ? "accumulation" : priorTrend === "up" ? "distribution" : "unclear",
    pierces,
    atrAtRange: round(rangeAtr, 4),
  };
}

/** 统计进入判定带的「次数」而非「根数」，连续多根贴边只算一次。 */
function countTouches(values: number[], level: number, side: "above" | "below"): number {
  let count = 0;
  let inside = false;
  for (const v of values) {
    const hit = side === "above" ? v >= level : v <= level;
    if (hit && !inside) count++;
    inside = hit;
  }
  return count;
}

/**
 * 判断进入区间之前的走势方向——这是区分吸筹与派发的唯一依据。
 * 以区间高度为标尺：前期要跨越一个区间高度以上，才算得上一段趋势。
 */
function classifyPriorTrend(
  klines: Kline[],
  start: number,
  rangeBars: number,
  height: number,
): TradingRange["priorTrend"] {
  const lookback = Math.min(start, Math.max(20, rangeBars));
  if (lookback < 5) return "flat";
  const move = klines[start].close - klines[start - lookback].close;
  if (move <= -height) return "down";
  if (move >= height) return "up";
  return "flat";
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
