import type {
  Kline,
  ResearchFundamentals,
  ResearchLevel,
  ResearchResponse,
  ResearchStrategy,
} from "@wyckoff/shared";
import { computeFeatures, type MarketFeatures } from "@wyckoff/wyckoff";
import { getState, setState } from "../db/index.js";
import { getKlines, MarketDataError } from "./market.js";
import { fetchSecFundamentals, fetchTencentQuote, type SecFundamentals, type TencentQuote } from "./researchData.js";
import { getInstrument } from "./instruments.js";

const HISTORY_WINDOW = 600;
const TENCENT_TTL = 15 * 60_000;
const SEC_TTL = 12 * 60 * 60_000;

function readCache<T>(key: string, ttl: number): T | null {
  try {
    const raw = getState(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; data: T };
    if (Date.now() - parsed.at > ttl) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T): void {
  try {
    setState(key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* cache is best-effort */
  }
}

function round(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function finiteOrNull(value: number | undefined | null): number | null {
  return value !== undefined && value !== null && Number.isFinite(value) ? value : null;
}

function regionCurrency(region: string): string {
  return region === "CN" ? "CNY" : region === "HK" ? "HKD" : "USD";
}

function latestQuote(klines: Kline[]) {
  const last = klines[klines.length - 1];
  const prev = klines[klines.length - 2];
  const changePct = prev && prev.close !== 0 ? ((last.close - prev.close) / prev.close) * 100 : null;
  return {
    price: round(last.close),
    prevClose: prev ? round(prev.close) : null,
    changePct: changePct === null ? null : round(changePct, 2),
    high: round(last.high),
    low: round(last.low),
    volume: last.volume,
    asOf: last.timestamp,
    source: "tickflow" as const,
  };
}

function levelDedupe(levels: ResearchLevel[], atr: number): ResearchLevel[] {
  const tolerance = Math.max(atr * 0.25, 0.0001);
  const result: ResearchLevel[] = [];
  for (const level of levels) {
    if (!Number.isFinite(level.price)) continue;
    if (result.some((existing) => Math.abs(existing.price - level.price) <= tolerance)) continue;
    result.push(level);
  }
  return result;
}

export function computeStrategy(
  features: Pick<MarketFeatures, "atr" | "trend" | "swings" | "tradingRanges">,
  klines: Kline[],
): ResearchStrategy {
  const last = klines[klines.length - 1];
  const price = last?.close ?? 0;
  const atr = features.atr.current > 0 ? features.atr.current : price * 0.02;
  const swings = features.swings;
  const ranges = features.tradingRanges.filter((range) => range.bars >= 20);
  // Only a range that contains or is near the current price is actionable.
  // An old base far below a trending price is context, not the active range.
  const active =
    [...ranges]
      .filter((range) => price >= range.support - atr * 1.5 && price <= range.resistance + atr * 1.5)
      .sort((a, b) => b.endIndex - a.endIndex)[0] ?? null;

  const swingLows = swings.filter((swing) => swing.type === "low" && swing.price < price);
  const swingHighs = swings.filter((swing) => swing.type === "high" && swing.price > price);
  const brokenResistance = swings
    .filter((swing) => swing.type === "high" && swing.price < price)
    .sort((a, b) => b.price - a.price)[0];
  const brokenSupport = swings
    .filter((swing) => swing.type === "low" && swing.price > price)
    .sort((a, b) => a.price - b.price)[0];
  const swingLow = [...swingLows].sort((a, b) => b.price - a.price)[0];
  const swingHigh = [...swingHighs].sort((a, b) => a.price - b.price)[0];

  const rangeSupport = active?.support ?? null;
  const rangeResistance = active?.resistance ?? null;
  const supportCandidate =
    rangeSupport ?? Math.max(swingLow?.price ?? -Infinity, brokenResistance?.price ?? -Infinity);
  const resistanceCandidate =
    rangeResistance ?? Math.min(swingHigh?.price ?? Infinity, brokenSupport?.price ?? Infinity);
  const support = Number.isFinite(supportCandidate) ? supportCandidate : price - atr * 2;
  const resistance = Number.isFinite(resistanceCandidate) ? resistanceCandidate : price + atr * 2;
  const height = Math.max(resistance - support, atr * 2);

  const trend = features.trend;
  const trendUp = trend.shortTerm === "up" && trend.mediumTerm !== "down";
  const trendDown = trend.shortTerm === "down" && trend.mediumTerm !== "up";
  const bias: ResearchStrategy["bias"] = trendUp ? "long" : trendDown ? "short" : "wait";

  const nearResistance = price >= resistance - atr * 0.5;
  const nearSupport = price <= support + atr * 0.5;

  let trigger: ResearchStrategy["trigger"];
  if (bias === "long") {
    if (active && price > resistance + atr * 0.25) {
      trigger = { kind: "reclaim", price: round(resistance) };
    } else if (nearResistance) {
      trigger = { kind: "breakout", price: round(resistance) };
    } else if (!active && brokenResistance && price > brokenResistance.price) {
      trigger = { kind: "reclaim", price: round(brokenResistance.price) };
    } else trigger = { kind: "hold", price: round(support) };
  } else if (bias === "short") {
    if (active && price < support - atr * 0.25) {
      trigger = { kind: "breakdown", price: round(support) };
    } else if (nearSupport) {
      trigger = { kind: "breakdown", price: round(support) };
    } else if (!active && brokenSupport && price < brokenSupport.price) {
      trigger = { kind: "breakdown", price: round(brokenSupport.price) };
    } else trigger = { kind: "hold", price: round(resistance) };
  } else if (price < support) {
    trigger = { kind: "breakdown", price: round(support) };
  } else if (price > resistance) {
    trigger = { kind: "breakout", price: round(resistance) };
  } else {
    trigger = trendDown
      ? { kind: "breakdown", price: round(support) }
      : { kind: "hold", price: round(support) };
  }

  let entryLow: number;
  let entryHigh: number;
  let stop: number;
  let target1: number;
  let target2: number;

  if (bias === "long") {
    if (trigger.kind === "breakout" || trigger.kind === "reclaim") {
      const level = trigger.price ?? resistance;
      entryLow = level - atr * 0.2;
      entryHigh = level + atr * 0.3;
      stop = level - atr * 0.8;
      target1 = level + height * 0.618;
      target2 = level + height;
    } else {
      entryLow = Math.max(support + atr * 0.15, Math.min(price - atr * 0.5, support + atr * 0.5));
      entryHigh = Math.max(entryLow, Math.min(price - atr * 0.1, support + atr));
      stop = support - atr * 0.6;
      target1 = resistance;
      target2 = resistance + height * 0.618;
    }
  } else if (bias === "short") {
    if (trigger.kind === "breakdown") {
      const level = trigger.price ?? support;
      entryLow = level - atr * 0.3;
      entryHigh = level + atr * 0.2;
      stop = level + atr * 0.8;
      target1 = level - height * 0.618;
      target2 = level - height;
    } else {
      entryLow = Math.min(resistance + atr * 0.1, price + atr * 0.5);
      entryHigh = Math.max(entryLow, resistance - atr * 0.1);
      stop = resistance + atr * 0.8;
      target1 = support;
      target2 = support - height * 0.618;
    }
  } else if (trigger.kind === "breakout" || trigger.kind === "reclaim") {
    const level = trigger.price ?? resistance;
    entryLow = level - atr * 0.2;
    entryHigh = level + atr * 0.3;
    stop = level - atr * 0.8;
    target1 = level + height * 0.5;
    target2 = level + height;
  } else if (trigger.kind === "breakdown") {
    const level = trigger.price ?? support;
    entryLow = level - atr * 0.3;
    entryHigh = level + atr * 0.2;
    stop = level + atr * 0.8;
    target1 = level - height * 0.5;
    target2 = level - height;
  } else {
    entryLow = support + atr * 0.15;
    entryHigh = support + atr * 0.65;
    stop = support - atr * 0.7;
    target1 = resistance;
    target2 = resistance + height * 0.5;
  }

  // Keep the zones and targets on the correct side of the current price even
  // when a range is compressed by a fast move.
  if (bias !== "short") {
    entryLow = Math.min(entryLow, entryHigh);
    entryHigh = Math.max(entryLow, entryHigh);
    if (target1 <= entryLow) target1 = entryHigh + Math.max(atr * 1.5, height * 0.618);
    if (target2 <= target1) target2 = target1 + Math.max(atr * 1.5, height * 0.618);
  } else {
    if (target1 >= entryHigh) target1 = entryLow - Math.max(atr * 1.5, height * 0.618);
    if (target2 >= target1) target2 = target1 - Math.max(atr * 1.5, height * 0.618);
  }

  const entryMid = (entryLow + entryHigh) / 2;
  const risk = Math.abs(entryMid - stop);
  const reward = Math.abs(target1 - entryMid);
  const riskReward = risk > 0 ? round(reward / risk, 2) : null;

  const rawSupports: ResearchLevel[] = [
    ...(rangeSupport !== null ? [{ price: rangeSupport, kind: "range" as const }] : []),
    ...(brokenResistance ? [{ price: brokenResistance.price, kind: "swing" as const, timestamp: brokenResistance.timestamp }] : []),
    ...swings
      .filter((swing) => swing.type === "low" && swing.price < price)
      .slice(-4)
      .map((swing) => ({ price: swing.price, kind: "swing" as const, timestamp: swing.timestamp })),
  ];
  const rawResistances: ResearchLevel[] = [
    ...(rangeResistance !== null ? [{ price: rangeResistance, kind: "range" as const }] : []),
    ...(brokenSupport ? [{ price: brokenSupport.price, kind: "swing" as const, timestamp: brokenSupport.timestamp }] : []),
    ...swings
      .filter((swing) => swing.type === "high" && swing.price > price)
      .slice(-4)
      .map((swing) => ({ price: swing.price, kind: "swing" as const, timestamp: swing.timestamp })),
  ];

  return {
    bias,
    trigger,
    entryLow: round(entryLow),
    entryHigh: round(entryHigh),
    stop: round(stop),
    target1: round(target1),
    target2: round(target2),
    riskReward,
    invalidation: {
      kind: bias === "short" || trigger.kind === "breakdown" ? "closeAbove" : "closeBelow",
      price: round(stop),
    },
    support: levelDedupe(rawSupports, atr).sort((a, b) => b.price - a.price).slice(0, 4).map((level) => ({ ...level, price: round(level.price) })),
    resistance: levelDedupe(rawResistances, atr).sort((a, b) => a.price - b.price).slice(0, 4).map((level) => ({ ...level, price: round(level.price) })),
    trend: {
      short: trend.shortTerm,
      medium: trend.mediumTerm,
      long: trend.longTerm,
      ma20: finiteOrNull(trend.ma20),
      ma50: finiteOrNull(trend.ma50),
      ma200: finiteOrNull(trend.ma200),
    },
    atr: round(atr),
    range: active
      ? {
          support: round(active.support),
          resistance: round(active.resistance),
          startTime: active.startTime,
          endTime: active.endTime,
          hypothesis: active.hypothesis,
        }
      : null,
  };
}

function buildFundamentals(
  tencent: TencentQuote | null,
  sec: SecFundamentals | null,
  instrument: NonNullable<Awaited<ReturnType<typeof getInstrument>>>,
  klines: Kline[],
): ResearchFundamentals {
  const price = klines[klines.length - 1]?.close ?? 0;
  const shares = instrument.totalShares ?? sec?.sharesOutstanding ?? null;
  const marketCap = tencent?.marketCap ?? (shares && price ? shares * price : null);
  const currency = tencent?.currency ?? regionCurrency(instrument.region);
  const week52 = klines.slice(-252);
  const week52High = tencent?.week52High ?? (week52.length ? Math.max(...week52.map((bar) => bar.high)) : null);
  const week52Low = tencent?.week52Low ?? (week52.length ? Math.min(...week52.map((bar) => bar.low)) : null);
  const pe = tencent?.pe && tencent.pe > 0 ? tencent.pe : null;
  const pb = tencent?.pb && tencent.pb > 0 ? tencent.pb : null;
  const sourceParts = [tencent ? "Tencent quote" : null, sec ? "SEC EDGAR" : null].filter(Boolean);

  return {
    source: sourceParts.length ? sourceParts.join(" · ") : "TickFlow price data",
    currency,
    companyName: sec?.companyName ?? tencent?.englishName ?? null,
    marketCap,
    pe,
    pb,
    eps: sec?.eps ?? (pe ? round(price / pe) : null),
    dividendYieldPct:
      sec?.dividendsPerShare && price > 0 ? round((sec.dividendsPerShare / price) * 100, 2) : null,
    week52High,
    week52Low,
    revenue: sec?.revenue ?? null,
    netIncome: sec?.netIncome ?? null,
    grossMarginPct:
      sec?.grossProfit && sec.revenue ? round((sec.grossProfit / sec.revenue) * 100, 2) : null,
    netMarginPct: sec?.netIncome && sec.revenue ? round((sec.netIncome / sec.revenue) * 100, 2) : null,
    roePct: sec?.netIncome && sec.equity ? round((sec.netIncome / sec.equity) * 100, 2) : null,
    fiscalYear: sec?.fiscalYear ?? null,
    updatedAt: new Date().toISOString(),
  };
}

export async function getResearch(params: {
  symbol: string;
  period: Parameters<typeof getKlines>[0]["period"];
  adjust: Parameters<typeof getKlines>[0]["adjust"];
}): Promise<ResearchResponse> {
  const instrument = await getInstrument(params.symbol);
  if (!instrument) throw new MarketDataError(`未找到 ${params.symbol}`, "NOT_FOUND", 404);

  const all = await getKlines(params);
  if (all.length === 0) throw new MarketDataError(`标的 ${params.symbol} 没有行情数据`, "NO_DATA", 404);
  const klines = all.slice(-HISTORY_WINDOW);
  const features = computeFeatures({ symbol: params.symbol, period: params.period, klines });

  const tencentKey = `research:tencent:${params.symbol}`;
  const secKey = `research:sec:${params.symbol}`;
  const cachedTencent = readCache<TencentQuote>(tencentKey, TENCENT_TTL);
  const cachedSec = readCache<SecFundamentals>(secKey, SEC_TTL);

  const [tencent, sec] = await Promise.all([
    cachedTencent ?? fetchTencentQuote(instrument).then((value) => {
      if (value) writeCache(tencentKey, value);
      return value;
    }),
    instrument.region === "US"
      ? cachedSec ??
        fetchSecFundamentals(params.symbol).then((value) => {
          if (value) writeCache(secKey, value);
          return value;
        })
      : Promise.resolve(null),
  ]);

  return {
    symbol: instrument.symbol,
    name: instrument.name,
    exchange: instrument.exchange,
    region: instrument.region,
    currency: tencent?.currency ?? regionCurrency(instrument.region),
    quote: latestQuote(klines),
    fundamentals: buildFundamentals(tencent, sec, instrument, klines),
    strategy: computeStrategy(features, klines),
    generatedAt: new Date().toISOString(),
  };
}
