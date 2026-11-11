import type {
  AdjustType,
  AgentEvent,
  AnnotationGroup,
  ChatContext,
  ChatMessage,
  Instrument,
  InstrumentDetail,
  Kline,
  Period,
  ResearchResponse,
  StoredAnnotation,
  WatchGroup,
  WatchItem,
  WyckoffAnnotation,
} from "@wyckoff/shared";
import { translate } from "../i18n.js";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** 免费档不支持分钟线，UI 需要针对性地给出升级提示。 */
  get isFreeTierRestriction(): boolean {
    return this.code === "FREE_TIER_RESTRICTED";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });

  const text = await response.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : {}; }
  catch { throw new ApiError("SERVICE_UNAVAILABLE", "服务暂时不可用，请稍后重试"); }

  if (!response.ok) {
    const err = body as { code?: string; message?: string; error?: string };
    const code = err.code ?? "HTTP_ERROR";
    const localized = translate(`error.${code}`);
    const message =
      localized !== `error.${code}`
        ? localized
        : (err.message ?? err.error ?? `请求失败（${response.status}）`);
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("auth:required"));
    }
    throw new ApiError(code, message);
  }
  return body as T;
}

// ————————————————— 行情 —————————————————

export interface KlineParams {
  symbol: string;
  period: Period;
  adjust: AdjustType;
  startTime?: number;
  endTime?: number;
  count?: number;
}

export function fetchKlines(params: KlineParams): Promise<{ klines: Kline[] }> {
  const query = new URLSearchParams({
    symbol: params.symbol,
    period: params.period,
    adjust: params.adjust,
  });
  if (params.startTime !== undefined) query.set("startTime", String(params.startTime));
  if (params.endTime !== undefined) query.set("endTime", String(params.endTime));
  if (params.count !== undefined) query.set("count", String(params.count));
  return request(`/klines?${query}`);
}

export function fetchInstrument(symbol: string): Promise<{ instrument: InstrumentDetail }> {
  return request(`/instrument/${encodeURIComponent(symbol)}`);
}

export function fetchCapabilities(): Promise<{ freeTier: boolean; note: string }> {
  return request("/capabilities");
}

export function fetchResearch(params: {
  symbol: string;
  period: Period;
  adjust: AdjustType;
}): Promise<ResearchResponse> {
  const query = new URLSearchParams({
    symbol: params.symbol,
    period: params.period,
    adjust: params.adjust,
  });
  return request(`/research?${query}`);
}

export interface CreditStatus {
  balance: number;
  inviteCode: string;
  inviteCount: number;
}

export function fetchCreditStatus(): Promise<CreditStatus> {
  return request("/credits/status");
}

// ————————————————— 检索与收藏 —————————————————

export function searchInstruments(
  query: string,
  limit = 30,
): Promise<{ results: (Instrument & { score: number })[]; indexSize: number }> {
  return request(`/search?q=${encodeURIComponent(query)}&limit=${limit}`);
}

export interface WatchlistPayload {
  groups: WatchGroup[];
  items: WatchItem[];
}

export function fetchWatchlist(): Promise<WatchlistPayload> {
  return request("/watchlist");
}

export function addToWatchlist(symbol: string, groupId?: number): Promise<WatchlistPayload> {
  return request("/watchlist/items", { method: "POST", body: JSON.stringify({ symbol, groupId }) });
}

export function removeFromWatchlist(symbol: string, groupId?: number): Promise<WatchlistPayload> {
  const query = groupId === undefined ? "" : `?groupId=${groupId}`;
  return request(`/watchlist/items/${encodeURIComponent(symbol)}${query}`, { method: "DELETE" });
}

export function createWatchGroup(name: string): Promise<WatchlistPayload> {
  return request("/watchlist/groups", { method: "POST", body: JSON.stringify({ name }) });
}

export function renameWatchGroup(id: number, name: string): Promise<WatchlistPayload> {
  return request(`/watchlist/groups/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
}

export function deleteWatchGroup(id: number): Promise<WatchlistPayload> {
  return request(`/watchlist/groups/${id}`, { method: "DELETE" });
}

export function reorderWatchlist(groupId: number, symbols: string[]): Promise<WatchlistPayload> {
  return request("/watchlist/reorder", { method: "POST", body: JSON.stringify({ groupId, symbols }) });
}

// ————————————————— 标注 —————————————————

export function fetchAnnotations(
  symbol: string,
  period: string,
): Promise<{ groups: AnnotationGroup[]; annotations: StoredAnnotation[] }> {
  return request(`/annotations?symbol=${encodeURIComponent(symbol)}&period=${period}`);
}

export function saveAnnotations(payload: {
  symbol: string;
  period: string;
  title: string;
  annotations: WyckoffAnnotation[];
}): Promise<{ groupId: string; annotations: StoredAnnotation[] }> {
  return request("/annotations", { method: "POST", body: JSON.stringify(payload) });
}

export function deleteAnnotation(id: string): Promise<{ ok: boolean }> {
  return request(`/annotations/${id}`, { method: "DELETE" });
}

export function deleteAnnotationGroup(groupId: string): Promise<{ ok: boolean }> {
  return request(`/annotations/groups/${groupId}`, { method: "DELETE" });
}

export function setAnnotationGroupVisible(groupId: string, visible: boolean): Promise<{ ok: boolean }> {
  return request(`/annotations/groups/${groupId}`, { method: "PATCH", body: JSON.stringify({ visible }) });
}

export function clearAnnotations(symbol: string, period: string): Promise<{ ok: boolean }> {
  return request("/annotations/clear", { method: "POST", body: JSON.stringify({ symbol, period }) });
}

// ————————————————— 会话 —————————————————

export function fetchSessions(symbol?: string): Promise<{ sessions: { id: string; symbol: string; period: string; title: string; createdAt: number; updatedAt: number }[] }> {
  const query = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
  return request(`/sessions${query}`);
}

export function fetchSessionMessages(sessionId: string): Promise<{ messages: ChatMessage[] }> {
  return request(`/sessions/${sessionId}/messages`);
}

export function fetchChatStatus(): Promise<{ configured: boolean }> {
  return request("/chat/status");
}

export interface ChatStreamParams {
  sessionId: string;
  symbol: string;
  period: Period;
  adjust: AdjustType;
  message: string;
  mode: "fundamental" | "agent" | "trade";
  language: "zh" | "en";
  showTrace?: boolean;
  context?: ChatContext;
  viewport?: { startTime: number; endTime: number };
}

/**
 * 发起一轮对话并按 SSE 逐事件回调。
 *
 * 用 fetch + ReadableStream 而不是 EventSource，因为需要 POST 携带较大的请求体
 * （上下文、视野范围），而 EventSource 只能发 GET。
 */
export async function streamChat(
  params: ChatStreamParams,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(params),
    signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    let message = `对话请求失败（${response.status}）`;
    let code = "CHAT_FAILED";
    try {
      const body = JSON.parse(text) as { message?: string; code?: string };
      message = body.message ?? message;
      code = body.code ?? code;
    } catch {
      /* 保持默认文案 */
    }
    const localized = translate(`error.${code}`);
    if (localized !== `error.${code}`) message = localized;
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("auth:required"));
    }
    throw new ApiError(code, message);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;

    // SSE 以空行分隔事件；最后一段可能不完整，留在缓冲区等下一个 chunk。
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const payload = chunk
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (!payload) continue;
      try {
        onEvent(JSON.parse(payload) as AgentEvent);
      } catch {
        console.warn("[chat] 无法解析的 SSE 数据：", payload);
      }
    }
  }
}
