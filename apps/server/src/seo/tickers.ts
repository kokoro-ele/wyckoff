/**
 * Symbols that get a public, indexable Wyckoff structure page. Kept as a
 * curated list (not every instrument) so each page has reliable data and the
 * sitemap stays small enough to be crawled completely.
 */
export interface SeoTicker {
  symbol: string;
  name: string;
  group: "US stocks" | "US ETFs" | "China A-shares";
}

export const SEO_TICKERS: SeoTicker[] = [
  { symbol: "NVDA.US", name: "NVIDIA", group: "US stocks" },
  { symbol: "AAPL.US", name: "Apple", group: "US stocks" },
  { symbol: "MSFT.US", name: "Microsoft", group: "US stocks" },
  { symbol: "AMZN.US", name: "Amazon", group: "US stocks" },
  { symbol: "GOOGL.US", name: "Alphabet", group: "US stocks" },
  { symbol: "META.US", name: "Meta Platforms", group: "US stocks" },
  { symbol: "TSLA.US", name: "Tesla", group: "US stocks" },
  { symbol: "AVGO.US", name: "Broadcom", group: "US stocks" },
  { symbol: "AMD.US", name: "AMD", group: "US stocks" },
  { symbol: "NFLX.US", name: "Netflix", group: "US stocks" },
  { symbol: "PLTR.US", name: "Palantir", group: "US stocks" },
  { symbol: "COIN.US", name: "Coinbase", group: "US stocks" },
  { symbol: "MSTR.US", name: "MicroStrategy", group: "US stocks" },
  { symbol: "SMCI.US", name: "Super Micro Computer", group: "US stocks" },
  { symbol: "INTC.US", name: "Intel", group: "US stocks" },
  { symbol: "MU.US", name: "Micron", group: "US stocks" },
  { symbol: "QCOM.US", name: "Qualcomm", group: "US stocks" },
  { symbol: "ORCL.US", name: "Oracle", group: "US stocks" },
  { symbol: "CRM.US", name: "Salesforce", group: "US stocks" },
  { symbol: "ADBE.US", name: "Adobe", group: "US stocks" },
  { symbol: "UBER.US", name: "Uber", group: "US stocks" },
  { symbol: "SHOP.US", name: "Shopify", group: "US stocks" },
  { symbol: "HOOD.US", name: "Robinhood", group: "US stocks" },
  { symbol: "SOFI.US", name: "SoFi", group: "US stocks" },
  { symbol: "ARM.US", name: "Arm Holdings", group: "US stocks" },
  { symbol: "TSM.US", name: "TSMC", group: "US stocks" },
  { symbol: "BABA.US", name: "Alibaba", group: "US stocks" },
  { symbol: "PDD.US", name: "PDD Holdings", group: "US stocks" },
  { symbol: "NIO.US", name: "NIO", group: "US stocks" },
  { symbol: "JPM.US", name: "JPMorgan Chase", group: "US stocks" },
  { symbol: "V.US", name: "Visa", group: "US stocks" },
  { symbol: "BRK.B.US", name: "Berkshire Hathaway B", group: "US stocks" },
  { symbol: "LLY.US", name: "Eli Lilly", group: "US stocks" },
  { symbol: "UNH.US", name: "UnitedHealth", group: "US stocks" },
  { symbol: "XOM.US", name: "Exxon Mobil", group: "US stocks" },
  { symbol: "WMT.US", name: "Walmart", group: "US stocks" },
  { symbol: "COST.US", name: "Costco", group: "US stocks" },
  { symbol: "DIS.US", name: "Disney", group: "US stocks" },
  { symbol: "BA.US", name: "Boeing", group: "US stocks" },
  { symbol: "SPY.US", name: "SPDR S&P 500 ETF", group: "US ETFs" },
  { symbol: "QQQ.US", name: "Invesco QQQ (Nasdaq-100)", group: "US ETFs" },
  { symbol: "IWM.US", name: "iShares Russell 2000 ETF", group: "US ETFs" },
  { symbol: "SMH.US", name: "VanEck Semiconductor ETF", group: "US ETFs" },
  { symbol: "GLD.US", name: "SPDR Gold Shares", group: "US ETFs" },
  { symbol: "TLT.US", name: "iShares 20+ Year Treasury ETF", group: "US ETFs" },
  { symbol: "600519.SH", name: "Kweichow Moutai", group: "China A-shares" },
  { symbol: "300750.SZ", name: "CATL", group: "China A-shares" },
  { symbol: "601318.SH", name: "Ping An Insurance", group: "China A-shares" },
  { symbol: "600036.SH", name: "China Merchants Bank", group: "China A-shares" },
  { symbol: "000858.SZ", name: "Wuliangye", group: "China A-shares" },
  { symbol: "002594.SZ", name: "BYD", group: "China A-shares" },
  { symbol: "601899.SH", name: "Zijin Mining", group: "China A-shares" },
  { symbol: "600900.SH", name: "China Yangtze Power", group: "China A-shares" },
  { symbol: "000333.SZ", name: "Midea Group", group: "China A-shares" },
  { symbol: "688981.SH", name: "SMIC", group: "China A-shares" },
];

/** NVDA.US → nvda, BRK.B.US → brk-b, 600519.SH → 600519-sh */
export function slugFor(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (upper.endsWith(".US")) return upper.slice(0, -3).toLowerCase().replaceAll(".", "-");
  return upper.toLowerCase().replaceAll(".", "-");
}

/** Inverse of slugFor; a bare ticker is a US symbol. Returns null for anything malformed. */
export function symbolFromSlug(slug: string): string | null {
  const value = slug.trim().toLowerCase();
  const china = /^(\d{6})-(sh|sz)$/.exec(value);
  if (china) return `${china[1]}.${china[2].toUpperCase()}`;
  if (!/^[a-z][a-z0-9]{0,6}(-[a-z])?$/.test(value)) return null;
  return `${value.replace("-", ".").toUpperCase()}.US`;
}

export function findTicker(symbol: string): SeoTicker | undefined {
  return SEO_TICKERS.find((ticker) => ticker.symbol === symbol);
}
