import { z } from "zod";
import type { WyckoffAnnotation } from "./annotation.js";
import type { Instrument, InstrumentDetail, Kline } from "./market.js";
import { adjustTypeSchema, periodSchema } from "./market.js";

// ————————————————— 运行时设置 —————————————————

export type RuntimeSettingsSource = "local" | "environment" | "none";

/**
 * 可安全返回浏览器的 LLM 配置视图。
 *
 * API Key 只用 configured/source 表达状态，绝不进入响应体。
 */
export interface RuntimeLlmSettings {
  configured: boolean;
  source: RuntimeSettingsSource;
  baseUrl: string;
  model: string;
  webSearch: boolean;
}

export interface RuntimeSettingsResponse {
  llm: RuntimeLlmSettings;
}

const httpUrlSchema = z
  .string()
  .trim()
  .min(1, "接口地址不能为空")
  .max(2048, "接口地址过长")
  .pipe(z.url({ protocol: /^https?$/, error: "接口地址必须是 HTTP 或 HTTPS URL" }));

export const updateLlmSettingsRequestSchema = z
  .object({
    /** 空字符串表示保留当前 Key；清除必须显式传 removeLocalKey。 */
    apiKey: z.string().max(8192, "API Key 过长").transform((value) => value.trim()).optional(),
    baseUrl: httpUrlSchema.optional(),
    model: z.string().trim().min(1, "模型名称不能为空").max(200, "模型名称过长").optional(),
    webSearch: z.boolean().optional(),
    removeLocalKey: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.removeLocalKey && value.apiKey) {
      ctx.addIssue({
        code: "custom",
        path: ["apiKey"],
        message: "不能同时设置和清除 API Key",
      });
    }
  });

export type UpdateLlmSettingsRequest = z.infer<typeof updateLlmSettingsRequestSchema>;

// ————————————————— 行情接口 —————————————————

export const klineQuerySchema = z.object({
  symbol: z.string().min(1),
  period: periodSchema.default("1d"),
  adjust: adjustTypeSchema.default("forward"),
  count: z.coerce.number().int().positive().max(10000).optional(),
  startTime: z.coerce.number().int().optional(),
  endTime: z.coerce.number().int().optional(),
});

export type KlineQuery = z.input<typeof klineQuerySchema>;

export interface KlineResponse {
  symbol: string;
  period: string;
  adjust: string;
  klines: Kline[];
}

export interface SearchResponse {
  results: (Instrument & { score: number })[];
}

// ————————————————— 收藏 —————————————————

export interface WatchGroup {
  id: number;
  name: string;
  sort: number;
  /** 系统托管分组只能由对应业务写入，用户侧不可改名、删除或手动增删项目。 */
  managed: boolean;
}

export interface WatchItem {
  symbol: string;
  name: string | null;
  exchange: string;
  type: string | null;
  groupId: number;
  sort: number;
}

// ————————————————— 对话上下文 —————————————————

/** 用户在画布上选中的内容，作为「上下文胶囊」注入对话。 */
export const chatContextSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("range"),
    startTime: z.number().int(),
    endTime: z.number().int(),
    priceLow: z.number().optional(),
    priceHigh: z.number().optional(),
  }),
  z.object({
    kind: z.literal("bar"),
    timestamp: z.number().int(),
  }),
]);

export type ChatContext = z.infer<typeof chatContextSchema>;

export const chatRequestSchema = z.object({
  sessionId: z.string(),
  symbol: z.string(),
  period: periodSchema.default("1d"),
  adjust: adjustTypeSchema.default("forward"),
  message: z.string(),
  context: chatContextSchema.optional(),
  /** 画布当前的可视时间范围，让 Agent 知道用户正在看哪一段。 */
  viewport: z.object({ startTime: z.number().int(), endTime: z.number().int() }).optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

// ————————————————— Agent 流式事件 —————————————————

export type AgentEvent =
  /** 助手正文的增量文本。 */
  | { type: "text"; delta: string }
  /** Agent 开始调用某个工具。 */
  | { type: "tool_start"; id: string; name: string; args: unknown }
  /** 工具执行结束。summary 是给用户看的一句话。 */
  | { type: "tool_end"; id: string; name: string; ok: boolean; summary: string; durationMs: number }
  /** 下发一批标注到画布。 */
  | { type: "annotations"; groupId: string; title: string; annotations: Array<WyckoffAnnotation & { id: string; groupId: string; source: "agent" | "user" }> }
  /** 清除标注。groupId 省略表示清空当前标的的全部 Agent 标注。 */
  | { type: "annotations_cleared"; groupId?: string }
  /** 请求画布滚动/缩放到指定时间范围。 */
  | { type: "focus_range"; startTime: number; endTime: number }
  /** 一轮回复结束。 */
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 助手消息附带的工具调用轨迹，用于在 UI 上展示 Agent 的思考过程。 */
  toolTrace?: { name: string; summary: string; ok: boolean; args?: unknown; durationMs?: number }[];
  context?: ChatContext;
  createdAt: number;
}

export type RecommendBucket = "watch" | "enter";

export interface RecommendBookItem {
  symbol: string;
  name: string | null;
  bucket: RecommendBucket;
  thesis: string;
  expectedReturnPct: number;
  stopPct: number;
  entryPrice: number;
  lastPrice: number | null;
  actualReturnPct: number | null;
  horizonDays: number;
  conviction: number;
  openedAt: number;
  /** 最近一次特征快照（行情读取 + 计算）耗时。 */
  featureMs: number | null;
  /** 最近一次改变该条推荐的运行，可用于回溯运行记录。 */
  lastRunId: string | null;
  /** 当次决策所依据的特征引擎与人类可读快照。 */
  featureEngineVersion: string | null;
  featureSummary: string | null;
  /** 新候选被发现时的舆情方向与理由。 */
  sourceNote: string | null;
}

export interface RecommendHistoryItem {
  id: string;
  symbol: string;
  name: string | null;
  bucket: RecommendBucket;
  openedAt: number;
  closedAt: number;
  entryPrice: number;
  exitPrice: number;
  expectedReturnPct: number;
  actualReturnPct: number;
  thesis: string;
  closeReason: string;
}

export interface RecommendRunSummary {
  id: string;
  ranAt: number;
  status: "ok" | "error" | "running";
  summary: string;
  emailSent: boolean;
  addedWatch: string[];
  addedEnter: string[];
  dropped: string[];
  upgraded: string[];
  downgraded: string[];
  durationMs: number;
  featureMs: number;
  featureCount: number;
  llmMs: number;
}

export interface RecommendSnapshot {
  running: boolean;
  lastRun: RecommendRunSummary | null;
  book: RecommendBookItem[];
  history: RecommendHistoryItem[];
  runs: RecommendRunSummary[];
}

export type { Instrument, InstrumentDetail, Kline };
