import type { AdjustType, CompactKlineData, Instrument, Kline, Period } from "@wyckoff/shared";
import { config } from "../config.js";

export class TickflowError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TickflowError";
  }

  /** 免费档不支持分钟线与实时行情，这类错误需要在 UI 上给出明确的升级引导。 */
  get isFreeTierRestriction(): boolean {
    return this.code === "FREE_TIER_RESTRICTED";
  }
}

async function request<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(`${config.tickflow.baseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = { accept: "application/json" };
  if (config.tickflow.apiKey) headers["x-api-key"] = config.tickflow.apiKey;

  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  const text = await response.text();

  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new TickflowError("BAD_RESPONSE", `TickFlow 返回了非 JSON 内容：${text.slice(0, 200)}`, response.status);
  }

  if (!response.ok) {
    const err = body as { code?: string; message?: string };
    throw new TickflowError(err.code ?? "HTTP_ERROR", err.message ?? `请求失败（HTTP ${response.status}）`, response.status);
  }
  return body as T;
}

/**
 * 列式转行式。
 *
 * TickFlow 为了节省带宽用的是列式紧凑格式（每个字段一个数组），
 * 图表和分析引擎都按「一根 K 线一个对象」来消费，这里做一次转换。
 */
export function expandKlines(data: CompactKlineData): Kline[] {
  const n = data.timestamp?.length ?? 0;
  const out: Kline[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = {
      timestamp: data.timestamp[i],
      open: data.open[i],
      high: data.high[i],
      low: data.low[i],
      close: data.close[i],
      volume: data.volume[i] ?? 0,
      amount: data.amount?.[i] ?? 0,
    };
  }
  // 防御性升序排序：缓存元数据（first/last_time）、滚动指标都假设 K 线按时间升序。
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

export interface FetchKlinesParams {
  symbol: string;
  period: Period;
  adjust: AdjustType;
  count?: number;
  startTime?: number;
  endTime?: number;
}

export async function fetchKlines(params: FetchKlinesParams): Promise<Kline[]> {
  const body = await request<{ data: CompactKlineData }>("/v1/klines", {
    symbol: params.symbol,
    period: params.period,
    adjust: params.adjust,
    count: params.count,
    start_time: params.startTime,
    end_time: params.endTime,
  });
  return expandKlines(body.data);
}

interface RawInstrument extends Instrument {
  ext?: Record<string, unknown> | null;
}

export async function fetchInstruments(symbols: string[]): Promise<RawInstrument[]> {
  if (symbols.length === 0) return [];
  const body = await request<{ data: RawInstrument[] }>("/v1/instruments", { symbols: symbols.join(",") });
  return body.data ?? [];
}

export async function fetchExchanges(): Promise<{ exchange: string; region: string; count: number }[]> {
  const body = await request<{ data: { exchange: string; region: string; count: number }[] }>("/v1/exchanges");
  return body.data ?? [];
}

export async function fetchExchangeInstruments(exchange: string, type?: string): Promise<RawInstrument[]> {
  const body = await request<{ data: RawInstrument[] }>(`/v1/exchanges/${encodeURIComponent(exchange)}/instruments`, {
    type,
  });
  return body.data ?? [];
}

export type { RawInstrument };
