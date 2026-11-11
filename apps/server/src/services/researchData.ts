import type { Instrument } from "@wyckoff/shared";

export interface TencentQuote {
  name: string | null;
  englishName: string | null;
  currency: string | null;
  marketCap: number | null;
  pe: number | null;
  pb: number | null;
  week52High: number | null;
  week52Low: number | null;
  updatedAt: string | null;
}

export interface SecFundamentals {
  companyName: string | null;
  revenue: number | null;
  netIncome: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  eps: number | null;
  equity: number | null;
  assets: number | null;
  liabilities: number | null;
  dividendsPerShare: number | null;
  sharesOutstanding: number | null;
  fiscalYear: string | null;
}

const TENCENT_PREFIX: Record<string, string> = {
  SH: "sh",
  SZ: "sz",
  BJ: "bj",
  HK: "hk",
  US: "us",
};

function fieldNumber(fields: string[], index: number): number | null {
  const value = Number(fields[index]);
  return Number.isFinite(value) && value !== 0 ? value : null;
}

/**
 * Tencent's public quote string is GBK-encoded. It is used only for valuation
 * context (market cap, PE, PB, 52-week range); chart prices still come from
 * TickFlow so the research panel and chart agree.
 */
export function parseTencentQuote(raw: string, instrument: Instrument): TencentQuote | null {
  const match = raw.match(/v_[^=]+="([^"]*)"/);
  if (!match) return null;
  const fields = match[1].split("~");
  if (fields.length < 50) return null;

  const currency = fields.find((value) => /^[A-Z]{3}$/.test(value)) ?? null;
  const englishName =
    fields[46] && /[A-Za-z]/.test(fields[46]) && !/^[a-z]+$/.test(fields[46]) ? fields[46] : null;
  // Mainland quotes place the 52-week range two fields earlier than US/HK.
  const week52High = fieldNumber(fields, instrument.region === "CN" ? 47 : 48);
  const week52Low = fieldNumber(fields, instrument.region === "CN" ? 48 : 49);
  const marketCapRaw = fieldNumber(fields, 44);

  return {
    name: fields[1] || null,
    englishName,
    currency,
    marketCap: marketCapRaw ? marketCapRaw * 1e8 : null,
    pe: fieldNumber(fields, 39),
    pb: fieldNumber(fields, 43),
    week52High,
    week52Low,
    updatedAt: fields[30] || null,
  };
}

export async function fetchTencentQuote(instrument: Instrument): Promise<TencentQuote | null> {
  const prefix = TENCENT_PREFIX[instrument.exchange];
  if (!prefix) return null;
  try {
    const response = await fetch(`https://qt.gtimg.cn/q=${prefix}${instrument.code}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36",
        Referer: "https://gu.qq.com/",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    let text: string;
    try {
      text = new TextDecoder("gbk").decode(buffer);
    } catch {
      text = buffer.toString("utf8");
    }
    return parseTencentQuote(text, instrument);
  } catch {
    return null;
  }
}

interface SecFact {
  start?: string;
  end?: string;
  val: number;
  form?: string;
  fp?: string;
  fy?: number;
}

interface SecFactSet {
  units?: Record<string, SecFact[]>;
}

type SecFacts = Record<string, SecFactSet>;

const SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SEC_FACTS_URL = (cik: string) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
let tickerCache: { at: number; byTicker: Map<string, { cik: string; title: string }> } | null = null;
const secCache = new Map<string, { at: number; data: SecFundamentals | null }>();

function secUserAgent(): string | null {
  const value = process.env.SEC_USER_AGENT?.trim();
  return value || null;
}

async function secJson<T>(url: string): Promise<T | null> {
  const userAgent = secUserAgent();
  if (!userAgent) return null;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": userAgent, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function secTickerMap(): Promise<Map<string, { cik: string; title: string }> | null> {
  if (tickerCache && Date.now() - tickerCache.at < 24 * 60 * 60_000) return tickerCache.byTicker;
  const payload = await secJson<Record<string, { cik_str: number; ticker: string; title: string }>>(SEC_TICKERS_URL);
  if (!payload) return null;
  const byTicker = new Map<string, { cik: string; title: string }>();
  for (const row of Object.values(payload)) {
    if (!row?.ticker) continue;
    byTicker.set(row.ticker.toUpperCase(), {
      cik: String(row.cik_str).padStart(10, "0"),
      title: row.title,
    });
  }
  tickerCache = { at: Date.now(), byTicker };
  return byTicker;
}

function latestFact(facts: SecFacts, concepts: string[], unit: string): SecFact | null {
  for (const concept of concepts) {
    const units = facts[concept]?.units?.[unit];
    if (!Array.isArray(units) || units.length === 0) continue;
    const annual = units.filter((fact) => fact.form === "10-K" && fact.fp === "FY");
    const pool = annual.length ? annual : units.filter((fact) => fact.form === "10-K");
    if (pool.length === 0) continue;
    const latest = [...pool]
      .filter((fact) => Number.isFinite(fact.val) && typeof fact.end === "string")
      .sort((a, b) => (b.end ?? "").localeCompare(a.end ?? ""))[0];
    if (latest) return latest;
  }
  return null;
}

export function parseSecFundamentals(
  facts: Record<string, SecFacts>,
  companyName: string | null,
): SecFundamentals | null {
  const usGaap = facts["us-gaap"];
  const dei = facts["dei"];
  if (!usGaap && !dei) return null;

  const revenue =
    (usGaap &&
      latestFact(
        usGaap,
        [
          "RevenueFromContractWithCustomerExcludingAssessedTax",
          "Revenues",
          "SalesRevenueNet",
          "RevenueFromContractWithCustomerIncludingAssessedTax",
        ],
        "USD",
      )) ??
    null;
  const netIncome = usGaap ? latestFact(usGaap, ["NetIncomeLoss"], "USD") : null;
  const grossProfit = usGaap ? latestFact(usGaap, ["GrossProfit"], "USD") : null;
  const operatingIncome = usGaap ? latestFact(usGaap, ["OperatingIncomeLoss"], "USD") : null;
  const eps = usGaap ? latestFact(usGaap, ["EarningsPerShareDiluted", "EarningsPerShareBasic"], "USD/shares") : null;
  const equity = usGaap ? latestFact(usGaap, ["StockholdersEquity"], "USD") : null;
  const assets = usGaap ? latestFact(usGaap, ["Assets"], "USD") : null;
  const liabilities = usGaap ? latestFact(usGaap, ["Liabilities"], "USD") : null;
  const dividendsPerShare = usGaap
    ? latestFact(
        usGaap,
        ["CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"],
        "USD/shares",
      )
    : null;
  const shares = dei ? latestFact(dei, ["EntityCommonStockSharesOutstanding"], "shares") : null;

  if (!revenue && !netIncome && !eps && !shares) return null;

  return {
    companyName,
    revenue: revenue?.val ?? null,
    netIncome: netIncome?.val ?? null,
    grossProfit: grossProfit?.val ?? null,
    operatingIncome: operatingIncome?.val ?? null,
    eps: eps?.val ?? null,
    equity: equity?.val ?? null,
    assets: assets?.val ?? null,
    liabilities: liabilities?.val ?? null,
    dividendsPerShare: dividendsPerShare?.val ?? null,
    sharesOutstanding: shares?.val ?? null,
    fiscalYear: (revenue?.end ?? netIncome?.end ?? shares?.end)?.slice(0, 4) ?? null,
  };
}

export async function fetchSecFundamentals(symbol: string): Promise<SecFundamentals | null> {
  if (!secUserAgent()) return null;
  const ticker = symbol.split(".")[0]?.toUpperCase();
  if (!ticker) return null;
  const cached = secCache.get(ticker);
  if (cached && Date.now() - cached.at < 12 * 60 * 60_000) return cached.data;

  const map = await secTickerMap();
  const entry = map?.get(ticker);
  if (!entry) {
    secCache.set(ticker, { at: Date.now(), data: null });
    return null;
  }
  const payload = await secJson<{ facts?: Record<string, SecFacts> }>(SEC_FACTS_URL(entry.cik));
  const parsed = payload?.facts ? parseSecFundamentals(payload.facts, entry.title) : null;
  secCache.set(ticker, { at: Date.now(), data: parsed });
  return parsed;
}
