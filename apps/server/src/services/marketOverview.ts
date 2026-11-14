import type { MarketOverviewResponse, MarketOverviewRow } from "@wyckoff/shared";
import { getKlines } from "./market.js";

const MARKET_SYMBOLS: Array<Pick<MarketOverviewRow, "symbol" | "name" | "nameEn" | "region">> = [
  { symbol: "NVDA.US", name: "NVIDIA", nameEn: "NVIDIA", region: "US" },
  { symbol: "AAPL.US", name: "Apple", nameEn: "Apple", region: "US" },
  { symbol: "TSLA.US", name: "Tesla", nameEn: "Tesla", region: "US" },
  { symbol: "MSFT.US", name: "Microsoft", nameEn: "Microsoft", region: "US" },
  { symbol: "600519.SH", name: "贵州茅台", nameEn: "Kweichow Moutai", region: "CN" },
  { symbol: "300750.SZ", name: "宁德时代", nameEn: "CATL", region: "CN" },
  { symbol: "00700.HK", name: "腾讯控股", nameEn: "Tencent", region: "HK" },
  { symbol: "09988.HK", name: "阿里巴巴", nameEn: "Alibaba", region: "HK" },
];

let cache: { at: number; data: MarketOverviewResponse } | null = null;
const CACHE_TTL = 60_000;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function compactAverage(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * A small, deliberately fixed watchlist. It is public data and is cached in
 * the shared market SQLite cache, so opening the market tab does not grow any
 * user's private workspace.
 */
export async function getMarketOverview(): Promise<MarketOverviewResponse> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.data;

  const rows = await Promise.all(
    MARKET_SYMBOLS.map(async (item): Promise<MarketOverviewRow | null> => {
      try {
        // 30 bars gives a 20-session volume baseline without a large payload.
        const bars = await getKlines({
          symbol: item.symbol,
          period: "1d",
          adjust: "forward",
          count: 30,
        });
        if (bars.length === 0) return null;
        const last = bars[bars.length - 1];
        const prev = bars[bars.length - 2];
        const baseline = bars.slice(-21, -1).map((bar) => bar.volume);
        const averageVolume = compactAverage(baseline);
        return {
          ...item,
          price: round(last.close),
          changePct: prev && prev.close > 0 ? round(((last.close - prev.close) / prev.close) * 100) : null,
          volume: last.volume,
          volumeRatio: averageVolume > 0 ? round(last.volume / averageVolume, 2) : null,
          amount: last.amount,
          high: round(last.high),
          low: round(last.low),
          asOf: last.timestamp,
        };
      } catch {
        return null;
      }
    }),
  );

  const data: MarketOverviewResponse = {
    rows: rows.filter((row): row is MarketOverviewRow => row !== null),
    updatedAt: new Date().toISOString(),
  };
  cache = { at: Date.now(), data };
  return data;
}
