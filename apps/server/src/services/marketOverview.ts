import type { MarketOverviewResponse, MarketOverviewRow } from "@wyckoff/shared";
import { getKlines } from "./market.js";
import { fetchTencentMarketQuotes } from "./researchData.js";

interface MarketSymbol {
  symbol: string;
  exchange: string;
  code: string;
  name: string;
  nameEn: string;
  region: "US" | "CN";
  sector: string;
}

const MARKET_SYMBOLS: MarketSymbol[] = [
  // US · technology
  { symbol: "NVDA.US", exchange: "US", code: "NVDA", name: "英伟达", nameEn: "NVIDIA", region: "US", sector: "semis" },
  { symbol: "AAPL.US", exchange: "US", code: "AAPL", name: "苹果", nameEn: "Apple", region: "US", sector: "tech" },
  { symbol: "MSFT.US", exchange: "US", code: "MSFT", name: "微软", nameEn: "Microsoft", region: "US", sector: "tech" },
  { symbol: "GOOGL.US", exchange: "US", code: "GOOGL", name: "谷歌", nameEn: "Alphabet", region: "US", sector: "tech" },
  { symbol: "META.US", exchange: "US", code: "META", name: "Meta", nameEn: "Meta", region: "US", sector: "tech" },
  { symbol: "AMD.US", exchange: "US", code: "AMD", name: "AMD", nameEn: "AMD", region: "US", sector: "semis" },
  { symbol: "AVGO.US", exchange: "US", code: "AVGO", name: "博通", nameEn: "Broadcom", region: "US", sector: "semis" },
  // US · consumer / financials / energy / healthcare / index
  { symbol: "AMZN.US", exchange: "US", code: "AMZN", name: "亚马逊", nameEn: "Amazon", region: "US", sector: "consumer" },
  { symbol: "TSLA.US", exchange: "US", code: "TSLA", name: "特斯拉", nameEn: "Tesla", region: "US", sector: "consumer" },
  { symbol: "JPM.US", exchange: "US", code: "JPM", name: "摩根大通", nameEn: "JPMorgan", region: "US", sector: "financials" },
  { symbol: "XOM.US", exchange: "US", code: "XOM", name: "埃克森美孚", nameEn: "Exxon Mobil", region: "US", sector: "energy" },
  { symbol: "LLY.US", exchange: "US", code: "LLY", name: "礼来", nameEn: "Eli Lilly", region: "US", sector: "healthcare" },
  { symbol: "SPY.US", exchange: "US", code: "SPY", name: "标普 500 ETF", nameEn: "S&P 500 ETF", region: "US", sector: "index" },
  { symbol: "QQQ.US", exchange: "US", code: "QQQ", name: "纳指 100 ETF", nameEn: "Nasdaq 100 ETF", region: "US", sector: "index" },
  // A-shares · consumer / new energy / financials / healthcare / energy
  { symbol: "600519.SH", exchange: "SH", code: "600519", name: "贵州茅台", nameEn: "Kweichow Moutai", region: "CN", sector: "consumer" },
  { symbol: "000858.SZ", exchange: "SZ", code: "000858", name: "五粮液", nameEn: "Wuliangye", region: "CN", sector: "consumer" },
  { symbol: "300750.SZ", exchange: "SZ", code: "300750", name: "宁德时代", nameEn: "CATL", region: "CN", sector: "new-energy" },
  { symbol: "002594.SZ", exchange: "SZ", code: "002594", name: "比亚迪", nameEn: "BYD", region: "CN", sector: "new-energy" },
  { symbol: "601318.SH", exchange: "SH", code: "601318", name: "中国平安", nameEn: "Ping An", region: "CN", sector: "financials" },
  { symbol: "600036.SH", exchange: "SH", code: "600036", name: "招商银行", nameEn: "China Merchants Bank", region: "CN", sector: "financials" },
  { symbol: "600276.SH", exchange: "SH", code: "600276", name: "恒瑞医药", nameEn: "Hengrui Pharma", region: "CN", sector: "healthcare" },
  { symbol: "601857.SH", exchange: "SH", code: "601857", name: "中国石油", nameEn: "PetroChina", region: "CN", sector: "energy" },
];

let cache: { at: number; data: MarketOverviewResponse } | null = null;
const CACHE_TTL = 60_000;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function fallbackRow(item: MarketSymbol, bars: Awaited<ReturnType<typeof getKlines>>, volumeRatio: number | null): MarketOverviewRow | null {
  const last = bars.at(-1);
  const prev = bars.at(-2);
  if (!last) return null;
  return {
    symbol: item.symbol,
    name: item.name,
    nameEn: item.nameEn,
    region: item.region,
    sector: item.sector,
    price: round(last.close),
    changePct: prev && prev.close > 0 ? round(((last.close - prev.close) / prev.close) * 100) : null,
    volume: last.volume,
    volumeRatio,
    amount: last.amount,
    high: round(last.high),
    low: round(last.low),
    asOf: last.timestamp,
  };
}

/**
 * Public market snapshot. Tencent's free batch quote endpoint provides dynamic
 * price/change/volume in one request; K-line data is only a fallback for a
 * symbol missing from that response.
 */
export async function getMarketOverview(): Promise<MarketOverviewResponse> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.data;

  const quotes = await fetchTencentMarketQuotes(MARKET_SYMBOLS);
  const rows: MarketOverviewRow[] = [];

  await Promise.all(
    MARKET_SYMBOLS.map(async (item) => {
      const quote = quotes.get(item.symbol);
      if (quote) {
        rows.push({
          symbol: item.symbol,
          name: item.name,
          nameEn: item.nameEn,
          region: item.region,
          sector: item.sector,
          price: round(quote.price),
          changePct: quote.changePct === null ? null : round(quote.changePct),
          volume: quote.volume,
          volumeRatio: null,
          amount: quote.amount,
          high: round(quote.high),
          low: round(quote.low),
          asOf: quote.asOf,
        });
        return;
      }
      try {
        const bars = await getKlines({
          symbol: item.symbol,
          period: "1d",
          adjust: "forward",
          count: 30,
        });
        const row = fallbackRow(item, bars, null);
        if (row) rows.push(row);
      } catch {
        /* omit unavailable symbols */
      }
    }),
  );

  const order = ["US", "CN"];
  rows.sort((a, b) => {
    const region = order.indexOf(a.region) - order.indexOf(b.region);
    if (region !== 0) return region;
    return MARKET_SYMBOLS.findIndex((item) => item.symbol === a.symbol) -
      MARKET_SYMBOLS.findIndex((item) => item.symbol === b.symbol);
  });

  const data: MarketOverviewResponse = {
    rows,
    updatedAt: new Date().toISOString(),
  };
  cache = { at: Date.now(), data };
  return data;
}
