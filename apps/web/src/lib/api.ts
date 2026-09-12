import type {
  AdjustType,
  AgentEvent,
  AnnotationGroup,
  BacktestHistoryResponse,
  BacktestRequestInput,
  BacktestResult,
  AiWyckoffBacktestDetailResponse,
  AiWyckoffBacktestHistoryResponse,
  AiWyckoffBacktestRequestInput,
  AiWyckoffBacktestStartResponse,
  ChatContext,
  ChatMessage,
  Instrument,
  InstrumentDetail,
  Kline,
  Period,
  RecommendSnapshot,
  RuntimeSettingsResponse,
  StoredAnnotation,
  UpdateLlmSettingsRequest,
  WatchGroup,
  WatchItem,
  WyckoffAnnotation,
} from "@wyckoff/shared";

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
  const body = text ? (JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    const err = body as { code?: string; message?: string };
    throw new ApiError(err.code ?? "HTTP_ERROR", err.message ?? `请求失败（${response.status}）`);
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

export function fetchRecommend(): Promise<RecommendSnapshot> {
  return request("/recommend");
}

export function runRecommend(): Promise<{ started: boolean; running: boolean }> {
  return request("/recommend/run", { method: "POST" });
}

// ————————————————— 回测 —————————————————

export function runBacktest(payload: BacktestRequestInput): Promise<{ result: BacktestResult }> {
  return request("/backtests/run", { method: "POST", body: JSON.stringify(payload) });
}

export function fetchBacktests(limit = 20): Promise<BacktestHistoryResponse> {
  const query = new URLSearchParams({ limit: String(limit) });
  return request(`/backtests?${query}`);
}

export function fetchBacktest(id: string): Promise<{ result: BacktestResult }> {
  return request(`/backtests/${encodeURIComponent(id)}`);
}

export function deleteBacktest(id: string): Promise<{ ok: true }> {
  return request(`/backtests/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ————————————————————— Wyckoff AI 计划回测 —————————————————————

export function runAiWyckoffBacktest(payload: AiWyckoffBacktestRequestInput): Promise<AiWyckoffBacktestStartResponse> {
  return request("/wyckoff-ai-backtests/run", { method: "POST", body: JSON.stringify(payload) });
}

export function fetchAiWyckoffBacktests(limit = 20): Promise<AiWyckoffBacktestHistoryResponse> {
  const query = new URLSearchParams({ limit: String(limit) });
  return request(`/wyckoff-ai-backtests?${query}`);
}

export function fetchAiWyckoffBacktest(id: string): Promise<AiWyckoffBacktestDetailResponse> {
  return request(`/wyckoff-ai-backtests/${encodeURIComponent(id)}`);
}

export function deleteAiWyckoffBacktest(id: string): Promise<{ ok: true }> {
  return request(`/wyckoff-ai-backtests/${encodeURIComponent(id)}`, { method: "DELETE" });
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

// ————————————————— 本地连接设置 —————————————————

export function fetchRuntimeSettings(): Promise<RuntimeSettingsResponse> {
  return request("/settings");
}

export function updateLlmSettings(payload: UpdateLlmSettingsRequest): Promise<RuntimeSettingsResponse> {
  return request("/settings/llm", { method: "PUT", body: JSON.stringify(payload) });
}

export interface ChatStreamParams {
  sessionId: string;
  symbol: string;
  period: Period;
  adjust: AdjustType;
  message: string;
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
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    let message = `对话请求失败（${response.status}）`;
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? message;
    } catch {
      /* 保持默认文案 */
    }
    throw new ApiError("CHAT_FAILED", message);
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
