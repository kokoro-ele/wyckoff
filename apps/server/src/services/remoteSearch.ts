import type { Instrument, InstrumentType, Region } from "@wyckoff/shared";

interface Hint {
  market: string;
  code: string;
  name: string;
  pinyin: string;
  kind: string;
}

const cache = new Map<string, { at: number; rows: Instrument[] }>();
const TTL = 60_000;

const MARKET: Record<string, { exchange: string; region: Region }> = {
  us: { exchange: "US", region: "US" },
  sh: { exchange: "SH", region: "CN" },
  sz: { exchange: "SZ", region: "CN" },
  bj: { exchange: "BJ", region: "CN" },
};

function typeOf(kind: string): InstrumentType {
  if (kind.startsWith("ZS")) return "index";
  if (kind.startsWith("ETF")) return "etf";
  if (kind.startsWith("QZ")) return "options";
  if (kind.startsWith("GP")) return "stock";
  return "other";
}

function toInstrument(hint: Hint): Instrument | null {
  const market = MARKET[hint.market];
  if (!market) return null; // Hong Kong is intentionally not exposed.
  const rawCode = hint.code.toLowerCase();
  const code = hint.market === "us" ? rawCode.split(".")[0] : rawCode;
  if (!code) return null;
  const symbol = hint.market === "us"
    ? `${code.toUpperCase()}.US`
    : `${code.toUpperCase()}.${market.exchange}`;
  const name = hint.name || null;
  return {
    symbol,
    exchange: market.exchange,
    code: code.toUpperCase(),
    name,
    nameEn: market.region === "US" && name && /^[A-Za-z0-9 .,&'()-]+$/.test(name) ? name : null,
    region: market.region,
    type: typeOf(hint.kind),
  };
}

/**
 * Tencent's smartbox endpoint gives instant symbol suggestions even when the
 * local exchange index is cold. It is a fallback only; local weighted search
 * remains the first choice.
 */
export async function searchRemoteInstruments(query: string): Promise<Instrument[]> {
  const q = query.trim();
  if (!q) return [];
  const cached = cache.get(q.toLowerCase());
  if (cached && Date.now() - cached.at < TTL) return cached.rows;

  try {
    const response = await fetch(`https://smartbox.gtimg.cn/s3/?v=2&q=${encodeURIComponent(q)}&t=all`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        Referer: "https://gu.qq.com/",
      },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return [];
    const buffer = Buffer.from(await response.arrayBuffer());
    const text = new TextDecoder("gbk").decode(buffer);
    const match = text.match(/v_hint="([^"]*)"/);
    if (!match) return [];
    const rows: Instrument[] = [];
    for (const entry of match[1].split("^")) {
      const [market, code, name, pinyin, kind] = entry.split("~");
      if (!market || !code) continue;
      const instrument = toInstrument({ market, code, name: name ?? "", pinyin: pinyin ?? "", kind: kind ?? "" });
      if (instrument && !rows.some((row) => row.symbol === instrument.symbol)) rows.push(instrument);
      if (rows.length >= 12) break;
    }
    cache.set(q.toLowerCase(), { at: Date.now(), rows });
    return rows;
  } catch {
    return [];
  }
}
