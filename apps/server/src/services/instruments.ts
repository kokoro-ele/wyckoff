import { workspaceContext } from "../cloud/context.js";
import type { Instrument, InstrumentDetail } from "@wyckoff/shared";
import { pinyin } from "pinyin-pro";
import { db, getState, setState } from "../db/index.js";
import { fetchExchangeInstruments, fetchInstruments, type RawInstrument } from "../tickflow/client.js";

/** TickFlow 覆盖的交易所。免费档也能拉全量标的清单。 */
const EXCHANGES = ["SH", "SZ", "BJ", "HK", "US"] as const;
const SYNC_STATE_KEY = "instruments_synced_at";
/** 标的清单变动不频繁，一周同步一次即可。 */
const SYNC_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface IndexedInstrument extends Instrument {
  pinyinFull: string;
  pinyinAbbr: string;
  /** 预先小写化，避免每次搜索都转换。 */
  lowerSymbol: string;
  lowerCode: string;
  lowerName: string;
}

/**
 * 全量标的常驻内存。
 *
 * 五个交易所加起来约 2.3 万条、几 MB 而已，全量放进内存换来的是完全可控的
 * 排序策略和亚毫秒响应；用 SQL 的 LIKE 反而既慢又难做加权。
 */
let localIndex: IndexedInstrument[] = [];
function getIndex(): IndexedInstrument[] {
  const context = workspaceContext.getStore();
  if (!context) return localIndex;
  const cached = context.state.get("instrument-index") as IndexedInstrument[] | undefined;
  if (cached) return cached;
  // Only search/instrument routes pay for loading the full directory.
  loadIndex();
  return (context.state.get("instrument-index") as IndexedInstrument[] | undefined) ?? [];
}

const upsertInstrument = db.prepare(`
  INSERT INTO instruments (symbol, exchange, code, name, region, type, pinyin_full, pinyin_abbr, ext)
  VALUES (@symbol, @exchange, @code, @name, @region, @type, @pinyin_full, @pinyin_abbr, @ext)
  ON CONFLICT(symbol) DO UPDATE SET
    exchange = excluded.exchange, code = excluded.code, name = excluded.name,
    region = excluded.region, type = excluded.type,
    pinyin_full = excluded.pinyin_full, pinyin_abbr = excluded.pinyin_abbr, ext = excluded.ext
`);

const storeInstruments = db.transaction((rows: RawInstrument[]) => {
  for (const item of rows) {
    const { full, abbr } = toPinyin(item.name);
    upsertInstrument.run({
      symbol: item.symbol,
      exchange: item.exchange,
      code: item.code,
      name: item.name ?? null,
      region: item.region,
      type: item.type ?? null,
      pinyin_full: full,
      pinyin_abbr: abbr,
      ext: item.ext ? JSON.stringify(item.ext) : null,
    });
  }
});

/** 中文名转全拼与首字母，让「pfyh」也能搜到「浦发银行」。 */
function toPinyin(name: string | null | undefined): { full: string; abbr: string } {
  if (!name || !/[\u4e00-\u9fa5]/.test(name)) return { full: "", abbr: "" };
  try {
    const full = pinyin(name, { toneType: "none", type: "array" }).join("");
    const abbr = pinyin(name, { pattern: "first", toneType: "none", type: "array" }).join("");
    return { full: full.toLowerCase(), abbr: abbr.toLowerCase() };
  } catch {
    return { full: "", abbr: "" };
  }
}

export function loadIndex(): void {
  const rows = db
    .prepare<[], { symbol: string; exchange: string; code: string; name: string | null; region: string; type: string | null; pinyin_full: string; pinyin_abbr: string }>(
      "SELECT symbol, exchange, code, name, region, type, pinyin_full, pinyin_abbr FROM instruments",
    )
    .all();

  const index = rows.map((r) => ({
    symbol: r.symbol,
    exchange: r.exchange,
    code: r.code,
    name: r.name,
    region: r.region,
    type: (r.type as Instrument["type"]) ?? null,
    pinyinFull: r.pinyin_full,
    pinyinAbbr: r.pinyin_abbr,
    lowerSymbol: r.symbol.toLowerCase(),
    lowerCode: r.code.toLowerCase(),
    lowerName: (r.name ?? "").toLowerCase(),
  }));
  const context = workspaceContext.getStore();
  if (context) context.state.set("instrument-index", index);
  else localIndex = index;
}

export function indexSize(): number {
  return getIndex().length;
}

export function isSyncNeeded(): boolean {
  if (getIndex().length === 0) return true;
  const syncedAt = Number(getState(SYNC_STATE_KEY) ?? 0);
  return Date.now() - syncedAt > SYNC_TTL_MS;
}

let syncing: Promise<void> | null = null;

/** 拉取五个交易所的全量标的。并发上限设为 2，避免免费服务被打限流。 */
export function syncInstruments(): Promise<void> {
  const context = workspaceContext.getStore();
  // The anonymous public cache is shared across requests on this instance.
  if ((!context || context.userId === "__public__") && syncing) return syncing;

  syncing = (async () => {
    console.log("[instruments] 开始同步标的清单…");
    const started = Date.now();
    let total = 0;

    for (const exchange of EXCHANGES) {
      try {
        const rows = await fetchExchangeInstruments(exchange);
        storeInstruments(rows);
        if (exchange === "US" && rows.length) setState("us_instruments_synced_at", String(Date.now()));
        total += rows.length;
        console.log(`[instruments] ${exchange} 收录 ${rows.length} 条`);
      } catch (error) {
        console.warn(`[instruments] ${exchange} 同步失败：`, (error as Error).message);
      }
    }

    loadIndex();
    setState(SYNC_STATE_KEY, String(Date.now()));
    console.log(`[instruments] 同步完成，共 ${total} 条，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
  })().finally(() => {
    syncing = null;
  });

  return syncing;
}

const TYPE_WEIGHT: Record<string, number> = { stock: 30, etf: 24, index: 20, fund: 10, bond: 6, options: 2, other: 0 };
const REGION_WEIGHT: Record<string, number> = { CN: 12, HK: 6, US: 8 };

/**
 * 加权搜索。命中方式的优先级从高到低是：
 * 完整代码 > 交易所内代码 > 中文名 > 拼音首字母 > 全拼。
 * 同分时用标的类型和市场做微调，让常见的股票 / ETF 排在期权、债券前面。
 */
export function searchInstruments(query: string, limit = 30): (Instrument & { score: number })[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const results: (Instrument & { score: number })[] = [];

  for (const item of getIndex()) {
    let score = 0;

    if (item.lowerSymbol === q) score = 1000;
    else if (item.lowerCode === q) score = 900;
    else if (item.lowerName === q) score = 880;
    else if (item.lowerSymbol.startsWith(q)) score = 780;
    else if (item.lowerCode.startsWith(q)) score = 760;
    else if (item.lowerName.startsWith(q)) score = 700;
    else if (item.pinyinAbbr && item.pinyinAbbr === q) score = 660;
    else if (item.pinyinAbbr && item.pinyinAbbr.startsWith(q)) score = 620;
    else if (item.lowerName.includes(q)) score = 520 - item.lowerName.indexOf(q) * 5;
    else if (item.pinyinFull && item.pinyinFull.startsWith(q)) score = 480;
    else if (item.pinyinFull && item.pinyinFull.includes(q)) score = 380;
    else if (item.lowerCode.includes(q)) score = 300;
    else continue;

    // 越短的名称与代码，越可能是用户想要的那个主标的。
    score += TYPE_WEIGHT[item.type ?? "other"] ?? 0;
    score += REGION_WEIGHT[item.region] ?? 0;
    score -= Math.min(item.lowerName.length, 20) * 0.5;

    results.push({
      symbol: item.symbol,
      exchange: item.exchange,
      code: item.code,
      name: item.name,
      region: item.region,
      type: item.type,
      score: Math.round(score * 10) / 10,
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** 取单个标的的详情，本地没有就回源一次。 */
export async function getInstrument(symbol: string): Promise<InstrumentDetail | null> {
  const row = db
    .prepare<[string], { symbol: string; exchange: string; code: string; name: string | null; region: string; type: string | null; ext: string | null }>(
      "SELECT symbol, exchange, code, name, region, type, ext FROM instruments WHERE symbol = ?",
    )
    .get(symbol);

  if (row) return toDetail(row);

  try {
    const [fetched] = await fetchInstruments([symbol]);
    if (!fetched) return null;
    storeInstruments([fetched]);
    loadIndex();
    return toDetail({ ...fetched, name: fetched.name ?? null, type: fetched.type ?? null, ext: fetched.ext ? JSON.stringify(fetched.ext) : null });
  } catch {
    return null;
  }
}

function toDetail(row: {
  symbol: string;
  exchange: string;
  code: string;
  name: string | null;
  region: string;
  type: string | null;
  ext: string | null;
}): InstrumentDetail {
  const ext = row.ext ? (JSON.parse(row.ext) as Record<string, unknown>) : {};
  return {
    symbol: row.symbol,
    exchange: row.exchange,
    code: row.code,
    name: row.name,
    region: row.region,
    type: (row.type as Instrument["type"]) ?? null,
    listingDate: (ext.listing_date as string | undefined) ?? null,
    totalShares: (ext.total_shares as number | undefined) ?? null,
    floatShares: (ext.float_shares as number | undefined) ?? null,
    tickSize: (ext.tick_size as number | undefined) ?? null,
    lotSize: (ext.lot_size as number | undefined) ?? null,
  };
}
