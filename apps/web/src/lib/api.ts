import type {
  AdjustType,
  AgentEvent,
  AgentMemorySnapshot,
  AgentTradePlan,
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
  publicId: string | null;
  ordinal: number | null;
  earlyBird: boolean;
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

export function fetchAgentMemory(params: { symbol: string; period: Period }): Promise<AgentMemorySnapshot> {
  const query = new URLSearchParams({ symbol: params.symbol, period: params.period });
  return request(`/chat/memory?${query}`);
}

export function interruptChat(params: {
  runId: string;
  symbol: string;
  period: Period;
  sessionId: string;
  question: string;
  language: "zh" | "en";
}): Promise<{ ok: boolean; memory?: AgentMemorySnapshot }> {
  return request(`/chat/interrupt?language=${params.language}`, {
    method: "POST",
    body: JSON.stringify({
      runId: params.runId,
      symbol: params.symbol,
      period: params.period,
      sessionId: params.sessionId,
      question: params.question,
    }),
  });
}

export function fetchTradePlan(params: {
  symbol: string;
  period: Period;
  adjust: AdjustType;
}): Promise<{ plan: AgentTradePlan | null }> {
  const query = new URLSearchParams({
    symbol: params.symbol,
    period: params.period,
    adjust: params.adjust,
  });
  return request(`/trade-plan?${query}`);
}

export interface LlmSettings {
  configured: boolean;
  source: "user" | "operator" | "none";
  mode: "operator" | "custom";
  byokEntitled: boolean;
  byokSource?: "subscription" | "lifetime" | "admin" | null;
  byokPeriodEnd?: string | null;
  baseUrl: string;
  model: string;
  custom: boolean;
  operatorConfigured: boolean;
}

export function fetchLlmSettings(): Promise<LlmSettings> {
  return request("/settings/llm");
}

export function saveLlmSettings(payload: {
  mode: "operator" | "custom";
  apiKey?: string;
  baseUrl: string;
  model: string;
}): Promise<LlmSettings> {
  return request("/settings/llm", { method: "PUT", body: JSON.stringify(payload) });
}

export function clearLlmSettings(): Promise<LlmSettings> {
  return request("/settings/llm", { method: "DELETE" });
}

export interface SubscriptionProduct {
  id: "byok_monthly" | "byok_lifetime";
  name: string;
  mode: "subscription" | "payment";
  amount: number;
  currency: string;
  available: boolean;
}

export function fetchSubscriptionCatalog(): Promise<{ products: SubscriptionProduct[] }> {
  return request("/credits/subscriptions/catalog");
}

export function fetchByokStatus(): Promise<{ byok: boolean; entitlement: { source: string; status: string; currentPeriodEnd: string | null } | null }> {
  return request("/credits/subscriptions/status");
}

export function openBillingPortal(): Promise<{ url: string }> {
  return request("/credits/subscriptions/portal", { method: "POST", body: JSON.stringify({}) });
}

export function checkoutSubscription(productId: string): Promise<{ orderId: string; product: string; mode: string; status: string; checkoutUrl?: string }> {
  return request("/credits/subscriptions/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ productId, provider: "stripe" }),
  });
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
  runId?: string;
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
    headers: { "content-type": "application/json", "Idempotency-Key": params.runId ?? crypto.randomUUID() },
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

// ————————————————— Admin —————————————————

export interface AdminOverview {
  users: number;
  verified: number;
  credits: number;
  analyses: number;
  orders: number;
  revenueMinor: number;
  recentSignups: { id: string; email: string; name: string | null; emailVerified: boolean; createdAt: string }[];
  recentOrders: {
    id: string;
    user_id: string;
    plan: string;
    period: string;
    credits: number | null;
    amount: number;
    currency: string;
    status: string;
    created_at: string;
  }[];
}

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  createdAt: string;
  balance: number;
  inviteCode: string | null;
  publicId: string | null;
  ordinal: number | null;
  analyses: string;
}

export function fetchAdminOverview(): Promise<AdminOverview> {
  return request("/admin/overview");
}

export function fetchAdminUsers(query = ""): Promise<{ users: AdminUser[] }> {
  return request(`/admin/users?query=${encodeURIComponent(query)}`);
}

export function setAdminCredits(userId: string, balance: number): Promise<{ ok: boolean; updated: number; balance: number }> {
  return request("/admin/credits", { method: "POST", body: JSON.stringify({ userId, balance }) });
}

export function resetAdminCredits(balance = 3): Promise<{ ok: boolean; updated: number; balance: number }> {
  return request("/admin/credits/reset", { method: "POST", body: JSON.stringify({ balance }) });
}

export interface AdminAnalytics {
  signups: { date: string; count: number }[];
  logins: { date: string; count: number }[];
  analyses: { date: string; analyses: number; users: number }[];
  today: { newToday: number; loginsToday: number; analysesToday: number; active7d: number };
  retention: { date: string; signups: number; d1: number }[];
  perUser: { email: string; name: string | null; analyses: number }[];
  cost: {
    analyses30d: number;
    avgPerVerifiedUser: number;
    avgPerActiveUser: number;
    creditsPerAnalysis: number;
    note: string;
  };
}

export function fetchAdminAnalytics(): Promise<AdminAnalytics> {
  return request("/admin/analytics");
}

export function fetchOnboarding(): Promise<{ seen: boolean }> {
  return request("/onboarding");
}

export function completeOnboarding(): Promise<{ ok: boolean }> {
  return request("/onboarding/complete", { method: "POST", body: JSON.stringify({}) });
}


export interface PurchaseRecord {
  id: string;
  kind: "credits" | "subscription";
  product: string;
  credits?: number | null;
  mode?: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  paid_at: string | null;
}

export function fetchPurchases(): Promise<{ purchases: PurchaseRecord[] }> {
  return request("/credits/purchases");
}

export interface ByokStatus {
  byok: boolean;
  entitlement: { source: string; status: string; currentPeriodEnd: string | null } | null;
}

export function fetchByokSubscriptionStatus(): Promise<ByokStatus> {
  return request("/credits/subscriptions/status");
}
