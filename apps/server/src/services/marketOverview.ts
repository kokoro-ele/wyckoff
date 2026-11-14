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
  // US · semiconductors
  { symbol: "NVDA.US", exchange: "US", code: "NVDA", name: "英伟达", nameEn: "NVIDIA", region: "US", sector: "semis" },
  { symbol: "AMD.US", exchange: "US", code: "AMD", name: "AMD", nameEn: "AMD", region: "US", sector: "semis" },
  { symbol: "AVGO.US", exchange: "US", code: "AVGO", name: "博通", nameEn: "Broadcom", region: "US", sector: "semis" },
  { symbol: "INTC.US", exchange: "US", code: "INTC", name: "英特尔", nameEn: "Intel", region: "US", sector: "semis" },
  { symbol: "QCOM.US", exchange: "US", code: "QCOM", name: "高通", nameEn: "Qualcomm", region: "US", sector: "semis" },
  { symbol: "MU.US", exchange: "US", code: "MU", name: "美光", nameEn: "Micron", region: "US", sector: "semis" },
  { symbol: "TSM.US", exchange: "US", code: "TSM", name: "台积电 ADR", nameEn: "TSMC ADR", region: "US", sector: "semis" },
  { symbol: "ASML.US", exchange: "US", code: "ASML", name: "阿斯麦 ADR", nameEn: "ASML ADR", region: "US", sector: "semis" },
  // US · technology
  { symbol: "AAPL.US", exchange: "US", code: "AAPL", name: "苹果", nameEn: "Apple", region: "US", sector: "tech" },
  { symbol: "MSFT.US", exchange: "US", code: "MSFT", name: "微软", nameEn: "Microsoft", region: "US", sector: "tech" },
  { symbol: "GOOGL.US", exchange: "US", code: "GOOGL", name: "谷歌", nameEn: "Alphabet", region: "US", sector: "tech" },
  { symbol: "META.US", exchange: "US", code: "META", name: "Meta", nameEn: "Meta", region: "US", sector: "tech" },
  { symbol: "ORCL.US", exchange: "US", code: "ORCL", name: "甲骨文", nameEn: "Oracle", region: "US", sector: "tech" },
  { symbol: "CRM.US", exchange: "US", code: "CRM", name: "Salesforce", nameEn: "Salesforce", region: "US", sector: "tech" },
  { symbol: "ADBE.US", exchange: "US", code: "ADBE", name: "Adobe", nameEn: "Adobe", region: "US", sector: "tech" },
  { symbol: "NFLX.US", exchange: "US", code: "NFLX", name: "奈飞", nameEn: "Netflix", region: "US", sector: "tech" },
  // US · consumer
  { symbol: "AMZN.US", exchange: "US", code: "AMZN", name: "亚马逊", nameEn: "Amazon", region: "US", sector: "consumer" },
  { symbol: "TSLA.US", exchange: "US", code: "TSLA", name: "特斯拉", nameEn: "Tesla", region: "US", sector: "consumer" },
  { symbol: "WMT.US", exchange: "US", code: "WMT", name: "沃尔玛", nameEn: "Walmart", region: "US", sector: "consumer" },
  { symbol: "COST.US", exchange: "US", code: "COST", name: "好市多", nameEn: "Costco", region: "US", sector: "consumer" },
  { symbol: "KO.US", exchange: "US", code: "KO", name: "可口可乐", nameEn: "Coca-Cola", region: "US", sector: "consumer" },
  { symbol: "PEP.US", exchange: "US", code: "PEP", name: "百事", nameEn: "PepsiCo", region: "US", sector: "consumer" },
  { symbol: "MCD.US", exchange: "US", code: "MCD", name: "麦当劳", nameEn: "McDonald's", region: "US", sector: "consumer" },
  { symbol: "NKE.US", exchange: "US", code: "NKE", name: "耐克", nameEn: "Nike", region: "US", sector: "consumer" },
  // US · financials
  { symbol: "JPM.US", exchange: "US", code: "JPM", name: "摩根大通", nameEn: "JPMorgan", region: "US", sector: "financials" },
  { symbol: "BAC.US", exchange: "US", code: "BAC", name: "美国银行", nameEn: "Bank of America", region: "US", sector: "financials" },
  { symbol: "WFC.US", exchange: "US", code: "WFC", name: "富国银行", nameEn: "Wells Fargo", region: "US", sector: "financials" },
  { symbol: "GS.US", exchange: "US", code: "GS", name: "高盛", nameEn: "Goldman Sachs", region: "US", sector: "financials" },
  { symbol: "MS.US", exchange: "US", code: "MS", name: "摩根士丹利", nameEn: "Morgan Stanley", region: "US", sector: "financials" },
  { symbol: "V.US", exchange: "US", code: "V", name: "Visa", nameEn: "Visa", region: "US", sector: "financials" },
  { symbol: "MA.US", exchange: "US", code: "MA", name: "万事达", nameEn: "Mastercard", region: "US", sector: "financials" },
  // US · energy
  { symbol: "XOM.US", exchange: "US", code: "XOM", name: "埃克森美孚", nameEn: "Exxon Mobil", region: "US", sector: "energy" },
  { symbol: "CVX.US", exchange: "US", code: "CVX", name: "雪佛龙", nameEn: "Chevron", region: "US", sector: "energy" },
  { symbol: "COP.US", exchange: "US", code: "COP", name: "康菲石油", nameEn: "ConocoPhillips", region: "US", sector: "energy" },
  { symbol: "SLB.US", exchange: "US", code: "SLB", name: "斯伦贝谢", nameEn: "SLB", region: "US", sector: "energy" },
  { symbol: "OXY.US", exchange: "US", code: "OXY", name: "西方石油", nameEn: "Occidental", region: "US", sector: "energy" },
  { symbol: "MPC.US", exchange: "US", code: "MPC", name: "马拉松石油", nameEn: "Marathon Petroleum", region: "US", sector: "energy" },
  // US · healthcare
  { symbol: "LLY.US", exchange: "US", code: "LLY", name: "礼来", nameEn: "Eli Lilly", region: "US", sector: "healthcare" },
  { symbol: "UNH.US", exchange: "US", code: "UNH", name: "联合健康", nameEn: "UnitedHealth", region: "US", sector: "healthcare" },
  { symbol: "JNJ.US", exchange: "US", code: "JNJ", name: "强生", nameEn: "Johnson & Johnson", region: "US", sector: "healthcare" },
  { symbol: "PFE.US", exchange: "US", code: "PFE", name: "辉瑞", nameEn: "Pfizer", region: "US", sector: "healthcare" },
  { symbol: "MRK.US", exchange: "US", code: "MRK", name: "默沙东", nameEn: "Merck", region: "US", sector: "healthcare" },
  { symbol: "ABBV.US", exchange: "US", code: "ABBV", name: "艾伯维", nameEn: "AbbVie", region: "US", sector: "healthcare" },
  { symbol: "TMO.US", exchange: "US", code: "TMO", name: "赛默飞", nameEn: "Thermo Fisher", region: "US", sector: "healthcare" },
  // US · index ETFs
  { symbol: "SPY.US", exchange: "US", code: "SPY", name: "标普 500 ETF", nameEn: "S&P 500 ETF", region: "US", sector: "index" },
  { symbol: "QQQ.US", exchange: "US", code: "QQQ", name: "纳指 100 ETF", nameEn: "Nasdaq 100 ETF", region: "US", sector: "index" },
  { symbol: "DIA.US", exchange: "US", code: "DIA", name: "道指 ETF", nameEn: "Dow ETF", region: "US", sector: "index" },
  { symbol: "IWM.US", exchange: "US", code: "IWM", name: "罗素 2000 ETF", nameEn: "Russell 2000 ETF", region: "US", sector: "index" },
  { symbol: "VTI.US", exchange: "US", code: "VTI", name: "全市场 ETF", nameEn: "Total Market ETF", region: "US", sector: "index" },
  // A-shares · consumer
  { symbol: "600519.SH", exchange: "SH", code: "600519", name: "贵州茅台", nameEn: "Kweichow Moutai", region: "CN", sector: "consumer" },
  { symbol: "000858.SZ", exchange: "SZ", code: "000858", name: "五粮液", nameEn: "Wuliangye", region: "CN", sector: "consumer" },
  { symbol: "000568.SZ", exchange: "SZ", code: "000568", name: "泸州老窖", nameEn: "Luzhou Laojiao", region: "CN", sector: "consumer" },
  { symbol: "600887.SH", exchange: "SH", code: "600887", name: "伊利股份", nameEn: "Yili", region: "CN", sector: "consumer" },
  { symbol: "601888.SH", exchange: "SH", code: "601888", name: "中国中免", nameEn: "China Tourism Group", region: "CN", sector: "consumer" },
  { symbol: "603288.SH", exchange: "SH", code: "603288", name: "海天味业", nameEn: "Haitian", region: "CN", sector: "consumer" },
  // A-shares · new energy
  { symbol: "300750.SZ", exchange: "SZ", code: "300750", name: "宁德时代", nameEn: "CATL", region: "CN", sector: "new-energy" },
  { symbol: "002594.SZ", exchange: "SZ", code: "002594", name: "比亚迪", nameEn: "BYD", region: "CN", sector: "new-energy" },
  { symbol: "601012.SH", exchange: "SH", code: "601012", name: "隆基绿能", nameEn: "LONGi", region: "CN", sector: "new-energy" },
  { symbol: "002129.SZ", exchange: "SZ", code: "002129", name: "TCL 中环", nameEn: "TCL Zhonghuan", region: "CN", sector: "new-energy" },
  { symbol: "300274.SZ", exchange: "SZ", code: "300274", name: "阳光电源", nameEn: "Sungrow", region: "CN", sector: "new-energy" },
  { symbol: "600438.SH", exchange: "SH", code: "600438", name: "通威股份", nameEn: "Tongwei", region: "CN", sector: "new-energy" },
  // A-shares · financials
  { symbol: "601318.SH", exchange: "SH", code: "601318", name: "中国平安", nameEn: "Ping An", region: "CN", sector: "financials" },
  { symbol: "600036.SH", exchange: "SH", code: "600036", name: "招商银行", nameEn: "China Merchants Bank", region: "CN", sector: "financials" },
  { symbol: "601398.SH", exchange: "SH", code: "601398", name: "工商银行", nameEn: "ICBC", region: "CN", sector: "financials" },
  { symbol: "601288.SH", exchange: "SH", code: "601288", name: "农业银行", nameEn: "Agricultural Bank of China", region: "CN", sector: "financials" },
  { symbol: "600030.SH", exchange: "SH", code: "600030", name: "中信证券", nameEn: "CITIC Securities", region: "CN", sector: "financials" },
  { symbol: "601166.SH", exchange: "SH", code: "601166", name: "兴业银行", nameEn: "Industrial Bank", region: "CN", sector: "financials" },
  // A-shares · healthcare
  { symbol: "600276.SH", exchange: "SH", code: "600276", name: "恒瑞医药", nameEn: "Hengrui Pharma", region: "CN", sector: "healthcare" },
  { symbol: "300760.SZ", exchange: "SZ", code: "300760", name: "迈瑞医疗", nameEn: "Mindray", region: "CN", sector: "healthcare" },
  { symbol: "603259.SH", exchange: "SH", code: "603259", name: "药明康德", nameEn: "WuXi AppTec", region: "CN", sector: "healthcare" },
  { symbol: "000538.SZ", exchange: "SZ", code: "000538", name: "云南白药", nameEn: "Yunnan Baiyao", region: "CN", sector: "healthcare" },
  { symbol: "600436.SH", exchange: "SH", code: "600436", name: "片仔癀", nameEn: "Pien Tze Huang", region: "CN", sector: "healthcare" },
  { symbol: "000661.SZ", exchange: "SZ", code: "000661", name: "长春高新", nameEn: "Changchun High-Tech", region: "CN", sector: "healthcare" },
  // A-shares · energy
  { symbol: "601857.SH", exchange: "SH", code: "601857", name: "中国石油", nameEn: "PetroChina", region: "CN", sector: "energy" },
  { symbol: "600028.SH", exchange: "SH", code: "600028", name: "中国石化", nameEn: "Sinopec", region: "CN", sector: "energy" },
  { symbol: "601088.SH", exchange: "SH", code: "601088", name: "中国神华", nameEn: "China Shenhua", region: "CN", sector: "energy" },
  { symbol: "600900.SH", exchange: "SH", code: "600900", name: "长江电力", nameEn: "China Yangtze Power", region: "CN", sector: "energy" },
  { symbol: "601225.SH", exchange: "SH", code: "601225", name: "陕西煤业", nameEn: "Shaanxi Coal", region: "CN", sector: "energy" },
  // A-shares · technology
  { symbol: "002415.SZ", exchange: "SZ", code: "002415", name: "海康威视", nameEn: "Hikvision", region: "CN", sector: "tech" },
  { symbol: "688981.SH", exchange: "SH", code: "688981", name: "中芯国际", nameEn: "SMIC", region: "CN", sector: "tech" },
  { symbol: "000725.SZ", exchange: "SZ", code: "000725", name: "京东方 A", nameEn: "BOE Technology", region: "CN", sector: "tech" },
  { symbol: "002475.SZ", exchange: "SZ", code: "002475", name: "立讯精密", nameEn: "Luxshare", region: "CN", sector: "tech" },
  { symbol: "300059.SZ", exchange: "SZ", code: "300059", name: "东方财富", nameEn: "East Money", region: "CN", sector: "tech" },
  { symbol: "002230.SZ", exchange: "SZ", code: "002230", name: "科大讯飞", nameEn: "iFlytek", region: "CN", sector: "tech" },
  { symbol: "600809.SH", exchange: "SH", code: "600809", name: "山西汾酒", nameEn: "Shanxi Fenjiu", region: "CN", sector: "consumer" },
  { symbol: "000333.SZ", exchange: "SZ", code: "000333", name: "美的集团", nameEn: "Midea Group", region: "CN", sector: "consumer" },
  { symbol: "002460.SZ", exchange: "SZ", code: "002460", name: "赣锋锂业", nameEn: "Ganfeng Lithium", region: "CN", sector: "new-energy" },
  { symbol: "300014.SZ", exchange: "SZ", code: "300014", name: "亿纬锂能", nameEn: "EVE Energy", region: "CN", sector: "new-energy" },
  { symbol: "601601.SH", exchange: "SH", code: "601601", name: "中国太保", nameEn: "CPIC", region: "CN", sector: "financials" },
  { symbol: "601688.SH", exchange: "SH", code: "601688", name: "华泰证券", nameEn: "Huatai Securities", region: "CN", sector: "financials" },
  { symbol: "300015.SZ", exchange: "SZ", code: "300015", name: "爱尔眼科", nameEn: "Aier Eye Hospital", region: "CN", sector: "healthcare" },
  { symbol: "000963.SZ", exchange: "SZ", code: "000963", name: "华东医药", nameEn: "Huadong Medicine", region: "CN", sector: "healthcare" },
  { symbol: "601985.SH", exchange: "SH", code: "601985", name: "中国核电", nameEn: "China National Nuclear", region: "CN", sector: "energy" },
  { symbol: "600011.SH", exchange: "SH", code: "600011", name: "华能国际", nameEn: "Huaneng Power", region: "CN", sector: "energy" },
  { symbol: "002371.SZ", exchange: "SZ", code: "002371", name: "北方华创", nameEn: "NAURA", region: "CN", sector: "tech" },
  { symbol: "600570.SH", exchange: "SH", code: "600570", name: "恒生电子", nameEn: "Hundsun", region: "CN", sector: "tech" },
  { symbol: "510300.SH", exchange: "SH", code: "510300", name: "沪深 300 ETF", nameEn: "CSI 300 ETF", region: "CN", sector: "index" },
  { symbol: "159919.SZ", exchange: "SZ", code: "159919", name: "沪深 300 ETF", nameEn: "CSI 300 ETF", region: "CN", sector: "index" },
];

const MARKET_INDICES: MarketSymbol[] = [
  { symbol: "INX.US", exchange: "US", code: "INX", name: "标普 500", nameEn: "S&P 500", region: "US", sector: "index" },
  { symbol: "NDX.US", exchange: "US", code: "NDX", name: "纳斯达克 100", nameEn: "Nasdaq 100", region: "US", sector: "index" },
  { symbol: "DJI.US", exchange: "US", code: "DJI", name: "道琼斯", nameEn: "Dow Jones", region: "US", sector: "index" },
  { symbol: "000001.SH", exchange: "SH", code: "000001", name: "上证指数", nameEn: "Shanghai Composite", region: "CN", sector: "index" },
  { symbol: "399001.SZ", exchange: "SZ", code: "399001", name: "深证成指", nameEn: "Shenzhen Component", region: "CN", sector: "index" },
  { symbol: "399006.SZ", exchange: "SZ", code: "399006", name: "创业板指", nameEn: "ChiNext", region: "CN", sector: "index" },
  { symbol: "000300.SH", exchange: "SH", code: "000300", name: "沪深 300", nameEn: "CSI 300", region: "CN", sector: "index" },
];

let cache: { at: number; data: MarketOverviewResponse } | null = null;
const CACHE_TTL = 60_000;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function fallbackRow(item: MarketSymbol, bars: Awaited<ReturnType<typeof getKlines>>): MarketOverviewRow | null {
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
    volumeRatio: null,
    turnoverRate: null,
    amount: last.amount,
    high: round(last.high),
    low: round(last.low),
    asOf: last.timestamp,
  };
}

function makeRow(item: MarketSymbol, quote: NonNullable<Awaited<ReturnType<typeof fetchTencentMarketQuotes>> extends Map<string, infer Q> ? Q : never>): MarketOverviewRow {
  return {
    symbol: item.symbol,
    name: item.name,
    nameEn: item.nameEn,
    region: item.region,
    sector: item.sector,
    price: round(quote.price),
    changePct: quote.changePct === null ? null : round(quote.changePct),
    volume: quote.volume,
    volumeRatio: null,
    turnoverRate: quote.turnoverRate === null ? null : round(quote.turnoverRate, 2),
    amount: quote.amount,
    high: round(quote.high),
    low: round(quote.low),
    asOf: quote.asOf,
  };
}

/**
 * Public market snapshot. Tencent's free batch quote endpoint provides dynamic
 * price/change/volume/turnover in one request; K-line data is only a fallback.
 */
export async function getMarketOverview(): Promise<MarketOverviewResponse> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.data;

  const allSymbols = [...MARKET_SYMBOLS, ...MARKET_INDICES];
  const quotes = await fetchTencentMarketQuotes(allSymbols);
  const rows: MarketOverviewRow[] = [];
  const indices: MarketOverviewRow[] = [];

  await Promise.all(allSymbols.map(async (item) => {
    const quote = quotes.get(item.symbol);
    if (quote) {
      (item.sector === "index" && MARKET_INDICES.some((index) => index.symbol === item.symbol) ? indices : rows)
        .push(makeRow(item, quote));
      return;
    }
    // Index symbols are often unavailable in the batch response. Only fetch a
    // K-line fallback for regular stocks; do not turn an index into a candle.
    if (item.sector === "index") return;
    try {
      const bars = await getKlines({
        symbol: item.symbol,
        period: "1d",
        adjust: "forward",
        count: 30,
      });
      const row = fallbackRow(item, bars);
      if (row) rows.push(row);
    } catch {
      /* omit unavailable symbols */
    }
  }));

  const order = (a: MarketOverviewRow, b: MarketOverviewRow) =>
    ["US", "CN"].indexOf(a.region) - ["US", "CN"].indexOf(b.region) ||
    allSymbols.findIndex((item) => item.symbol === a.symbol) - allSymbols.findIndex((item) => item.symbol === b.symbol);
  rows.sort(order);
  indices.sort(order);

  const data: MarketOverviewResponse = {
    rows,
    indices,
    updatedAt: new Date().toISOString(),
  };
  cache = { at: Date.now(), data };
  return data;
}
