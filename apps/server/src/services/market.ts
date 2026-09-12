import {
  BENCHMARK_BY_EXCHANGE,
  FREE_TIER_PERIODS,
  type AdjustType,
  type Kline,
  type Period,
  PERIOD_LABELS,
} from "@wyckoff/shared";
import { computeFeatures, computeRelativeStrength, type MarketFeatures } from "@wyckoff/wyckoff";
import { isFreeTier } from "../config.js";
import { db } from "../db/index.js";
import { fetchKlines, TickflowError } from "../tickflow/client.js";

/** 免费档日线在收盘后才更新，缓存 6 小时足够新鲜又能避免反复回源。 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** TickFlow 单次请求的 K 线上限。一次拉满就能覆盖全部历史，后续缩放不再回源。 */
const MAX_COUNT = 10_000;

const selectMeta = db.prepare<[string, string, string], { first_time: number; last_time: number; fetched_at: number }>(
  "SELECT first_time, last_time, fetched_at FROM kline_meta WHERE symbol = ? AND period = ? AND adjust = ?",
);

const insertKline = db.prepare(`
  INSERT INTO klines (symbol, period, adjust, timestamp, open, high, low, close, volume, amount)
  VALUES (@symbol, @period, @adjust, @timestamp, @open, @high, @low, @close, @volume, @amount)
  ON CONFLICT(symbol, period, adjust, timestamp) DO UPDATE SET
    open = excluded.open, high = excluded.high, low = excluded.low,
    close = excluded.close, volume = excluded.volume, amount = excluded.amount
`);

const upsertMeta = db.prepare(`
  INSERT INTO kline_meta (symbol, period, adjust, first_time, last_time, fetched_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(symbol, period, adjust) DO UPDATE SET
    -- 本地会留下窗口左移后掉出去的旧 bar，first_time 必须取更早的那头，
    -- 不能被「最近 10000 根」的左端覆盖。last_time 同理取更晚。
    first_time = MIN(first_time, excluded.first_time),
    last_time  = MAX(last_time, excluded.last_time),
    fetched_at = excluded.fetched_at
`);

const storeKlines = db.transaction(
  (symbol: string, period: string, adjust: string, klines: Kline[]) => {
    for (const bar of klines) insertKline.run({ symbol, period, adjust, ...bar });
    if (klines.length > 0) {
      upsertMeta.run(symbol, period, adjust, klines[0].timestamp, klines[klines.length - 1].timestamp, Date.now());
    }
  },
);

export interface GetKlinesParams {
  symbol: string;
  period: Period;
  adjust: AdjustType;
  startTime?: number;
  endTime?: number;
  count?: number;
}

export class MarketDataError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "MarketDataError";
  }
}

function assertPeriodAvailable(period: Period): void {
  if (isFreeTier && !FREE_TIER_PERIODS.includes(period)) {
    throw new MarketDataError(
      `当前使用的是 TickFlow 免费服务，不支持${PERIOD_LABELS[period]}。` +
        `在 .env 中配置 TICKFLOW_API_KEY 并把 TICKFLOW_BASE_URL 改为 https://api.tickflow.org 即可解锁分钟线。`,
      "FREE_TIER_RESTRICTED",
      403,
    );
  }
}

/**
 * 保证某个 (标的,周期,复权) 组合的历史已经落到本地。
 *
 * 一次就把上限根数全拉下来：日线 10000 根约等于 40 年，等于一次回源换来
 * 之后所有缩放、平移、特征计算的零延迟。回源失败但本地有旧数据时降级使用旧数据。
 */
async function ensureCached(symbol: string, period: Period, adjust: AdjustType): Promise<void> {
  const meta = selectMeta.get(symbol, period, adjust);
  if (meta && Date.now() - meta.fetched_at < CACHE_TTL_MS) return;

  try {
    const klines = await fetchKlines({ symbol, period, adjust, count: MAX_COUNT });
    if (klines.length === 0 && !meta) {
      throw new MarketDataError(`标的 ${symbol} 没有返回任何 K 线数据。`, "NO_DATA", 404);
    }
    storeKlines(symbol, period, adjust, klines);
  } catch (error) {
    if (error instanceof MarketDataError) throw error;
    if (meta) {
      console.warn(`[market] ${symbol} ${period} 回源失败，改用本地缓存：`, (error as Error).message);
      return;
    }
    if (error instanceof TickflowError) {
      throw new MarketDataError(error.message, error.code, error.status);
    }
    throw error;
  }
}

export async function getKlines(params: GetKlinesParams): Promise<Kline[]> {
  const { symbol, period, adjust, startTime, endTime, count } = params;
  assertPeriodAvailable(period);
  await ensureCached(symbol, period, adjust);

  const where: string[] = ["symbol = ?", "period = ?", "adjust = ?"];
  const args: (string | number)[] = [symbol, period, adjust];
  if (startTime !== undefined) {
    where.push("timestamp >= ?");
    args.push(startTime);
  }
  if (endTime !== undefined) {
    where.push("timestamp <= ?");
    args.push(endTime);
  }

  // count 语义是「最近 N 根」，所以先倒序取再翻回来。
  const limit = count ? " ORDER BY timestamp DESC LIMIT ?" : " ORDER BY timestamp ASC";
  if (count) args.push(count);

  const rows = db
    .prepare<(string | number)[], Kline>(
      `SELECT timestamp, open, high, low, close, volume, amount FROM klines WHERE ${where.join(" AND ")}${limit}`,
    )
    .all(...args);

  return count ? rows.reverse() : rows;
}

/** 计算完整的 Wyckoff 特征，并尽量附上相对基准指数的强弱。 */
export async function getFeatures(params: GetKlinesParams): Promise<MarketFeatures> {
  const klines = await getKlines(params);
  const features = computeFeatures({ symbol: params.symbol, period: params.period, klines });

  const exchange = params.symbol.split(".")[1] ?? "";
  const benchmark = BENCHMARK_BY_EXCHANGE[exchange];
  if (benchmark && benchmark !== params.symbol && klines.length > 0) {
    try {
      const benchKlines = await getKlines({
        symbol: benchmark,
        period: params.period,
        adjust: "none",
        startTime: klines[0].timestamp,
        endTime: klines[klines.length - 1].timestamp,
      });
      features.relativeStrength = computeRelativeStrength(klines, benchKlines, benchmark);
    } catch (error) {
      // 基准指数取不到不该影响主体分析，静默跳过即可。
      console.warn(`[market] 基准 ${benchmark} 获取失败：`, (error as Error).message);
    }
  }

  return features;
}
