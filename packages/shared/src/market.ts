import { z } from "zod";

/** TickFlow 支持的 K 线周期。免费服务仅开放 1d 及以上。 */
export const PERIODS = ["1m", "5m", "15m", "30m", "60m", "1d", "1w", "1M", "1Q", "1Y"] as const;
export type Period = (typeof PERIODS)[number];

/** 免费服务（free-api.tickflow.org）可用的周期子集。 */
export const FREE_TIER_PERIODS: readonly Period[] = ["1d", "1w", "1M", "1Q", "1Y"];

export const ADJUST_TYPES = ["none", "forward", "backward", "forward_additive", "backward_additive"] as const;
export type AdjustType = (typeof ADJUST_TYPES)[number];

export const periodSchema = z.enum(PERIODS);
export const adjustTypeSchema = z.enum(ADJUST_TYPES);

export const PERIOD_LABELS: Record<Period, string> = {
  "1m": "1分钟",
  "5m": "5分钟",
  "15m": "15分钟",
  "30m": "30分钟",
  "60m": "60分钟",
  "1d": "日线",
  "1w": "周线",
  "1M": "月线",
  "1Q": "季线",
  "1Y": "年线",
};

export const ADJUST_LABELS: Record<AdjustType, string> = {
  none: "不复权",
  forward: "前复权",
  backward: "后复权",
  forward_additive: "前复权(加法)",
  backward_additive: "后复权(加法)",
};

/** 单根 K 线。timestamp 为毫秒。 */
export interface Kline {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** 成交额。部分市场（如美股）不提供，为 0。 */
  amount: number;
}

/** TickFlow 返回的列式紧凑格式。 */
export interface CompactKlineData {
  timestamp: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
  amount?: number[];
  prev_close?: number[];
}

export type InstrumentType = "stock" | "etf" | "index" | "bond" | "fund" | "options" | "other";
export type Region = "CN" | "US" | "HK";

export interface Instrument {
  /** 完整标的代码，如 "600000.SH" / "AAPL.US" */
  symbol: string;
  /** 交易所代码：SH / SZ / BJ / HK / US */
  exchange: string;
  /** 交易所内代码，如 "600000" */
  code: string;
  name: string | null;
  region: string;
  type: InstrumentType | null;
}

export interface InstrumentDetail extends Instrument {
  listingDate?: string | null;
  totalShares?: number | null;
  floatShares?: number | null;
  tickSize?: number | null;
  lotSize?: number | null;
}

/** 各交易所的基准指数，用于计算相对强度。 */
export const BENCHMARK_BY_EXCHANGE: Record<string, string> = {
  SH: "000001.SH",
  SZ: "399001.SZ",
  BJ: "899050.BJ",
  HK: "HSI.HK",
  US: "SPX.US",
};

/** 时间跨度快捷选项，值为大致自然日数，null 表示全部历史。 */
export const TIME_SPANS = [
  { id: "3M", label: "3月", days: 92 },
  { id: "6M", label: "6月", days: 183 },
  { id: "1Y", label: "1年", days: 366 },
  { id: "3Y", label: "3年", days: 1096 },
  { id: "5Y", label: "5年", days: 1827 },
  { id: "ALL", label: "全部", days: null },
] as const;

export type TimeSpanId = (typeof TIME_SPANS)[number]["id"];
