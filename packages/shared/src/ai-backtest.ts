import { z } from "zod";
import { adjustTypeSchema } from "./market.js";
import { wyckoffEventCodeSchema } from "./annotation.js";

export const AI_WYCKOFF_PLAN_KINDS = [
  "observe",
  "spring_test_long",
  "sos_lps_long",
  "reaccumulation_long",
  "ut_utad_exit",
  "sow_lpsy_exit",
] as const;

export const AI_WYCKOFF_ACTIONS = ["enter_long", "exit_long", "observe"] as const;
export const AI_WYCKOFF_PHASES = ["A", "B", "C", "D", "E", "unknown"] as const;

export const aiWyckoffPlanKindSchema = z.enum(AI_WYCKOFF_PLAN_KINDS);
export const aiWyckoffActionSchema = z.enum(AI_WYCKOFF_ACTIONS);
export const aiWyckoffPhaseSchema = z.enum(AI_WYCKOFF_PHASES);

const anonymousBarIdSchema = z.string().regex(/^BAR_\d{6,}$/, "证据必须引用 BAR_000001 形式的匿名 K 线编号");

export const aiWyckoffEvidenceSchema = z.object({
  barId: anonymousBarIdSchema,
  observation: z.string().trim().min(1).max(240),
});

/**
 * 服务端在模型输出通过校验后附加的审计信息。保持为 JSON 对象，便于不同模型网关
 * 记录 model、promptVersion、inputHash、rawResponse、latencyMs、usage 等字段。
 */
export const aiWyckoffDecisionAuditSchema = z.record(z.string(), z.unknown()).default({});

export const aiWyckoffDecisionSchema = z
  .object({
    /** 完整历史数组中的零基下标；由服务端注入，模型不负责猜测。 */
    decisionBarIndex: z.number().int().nonnegative(),
    kind: aiWyckoffPlanKindSchema,
    phase: aiWyckoffPhaseSchema,
    event: wyckoffEventCodeSchema.nullable(),
    action: aiWyckoffActionSchema,
    /** 均以决策根 close=100 的匿名坐标表达，回放前再确定性映射到真实价格。 */
    entryLevel: z.number().finite().positive().max(10_000).optional(),
    stopLevel: z.number().finite().positive().max(10_000).optional(),
    targetLevel: z.number().finite().positive().max(10_000).optional(),
    evidence: z.array(aiWyckoffEvidenceSchema).min(1).max(16),
    missingConfirmation: z.array(z.string().trim().min(1).max(240)).max(12),
    invalidation: z.array(z.string().trim().min(1).max(240)).max(12),
    audit: aiWyckoffDecisionAuditSchema,
  })
  .superRefine((value, context) => {
    const entryKind =
      value.kind === "spring_test_long" || value.kind === "sos_lps_long" || value.kind === "reaccumulation_long";
    const exitKind = value.kind === "ut_utad_exit" || value.kind === "sow_lpsy_exit";

    if (value.action === "enter_long") {
      if (!entryKind) {
        context.addIssue({ code: "custom", path: ["kind"], message: "enter_long 必须使用做多计划种类" });
      }
      if (value.entryLevel === undefined || value.stopLevel === undefined) {
        context.addIssue({ code: "custom", path: ["entryLevel"], message: "enter_long 必须同时给出 entryLevel 与 stopLevel" });
      } else if (value.stopLevel >= value.entryLevel) {
        context.addIssue({ code: "custom", path: ["stopLevel"], message: "做多计划的 stopLevel 必须低于 entryLevel" });
      }
      if (value.targetLevel !== undefined && value.entryLevel !== undefined && value.targetLevel <= value.entryLevel) {
        context.addIssue({ code: "custom", path: ["targetLevel"], message: "做多计划的 targetLevel 必须高于 entryLevel" });
      }
    } else if (value.action === "exit_long") {
      if (!exitKind) {
        context.addIssue({ code: "custom", path: ["kind"], message: "exit_long 必须使用离场计划种类" });
      }
    } else if (value.kind !== "observe") {
      context.addIssue({ code: "custom", path: ["kind"], message: "observe 动作必须使用 observe 计划种类" });
    }
  });

export type AiWyckoffPlanKind = z.infer<typeof aiWyckoffPlanKindSchema>;
export type AiWyckoffAction = z.infer<typeof aiWyckoffActionSchema>;
export type AiWyckoffPhase = z.infer<typeof aiWyckoffPhaseSchema>;
export type AiWyckoffEvidence = z.infer<typeof aiWyckoffEvidenceSchema>;
export type AiWyckoffDecision = z.infer<typeof aiWyckoffDecisionSchema>;
export type AiWyckoffDecisionInput = z.input<typeof aiWyckoffDecisionSchema>;

export const aiWyckoffBacktestRequestSchema = z
  .object({
    symbol: z.string().trim().min(1).max(32),
    period: z.literal("1d").default("1d"),
    adjust: adjustTypeSchema.default("forward"),
    startTime: z.coerce.number().int().positive().optional(),
    endTime: z.coerce.number().int().positive().optional(),
    initialCapital: z.coerce.number().finite().min(1_000).max(1_000_000_000).default(100_000),
    positionSizePct: z.coerce.number().finite().min(1).max(100).default(100),
    commissionBps: z.coerce.number().finite().min(0).max(100).default(5),
    slippageBps: z.coerce.number().finite().min(0).max(100).default(5),
    maxHoldingBars: z.coerce.number().int().min(1).max(2_000).default(120),
    contextBars: z.coerce.number().int().min(40).max(300).default(160),
    rangeLookback: z.coerce.number().int().min(10).max(250).default(40),
    planValidBars: z.coerce.number().int().min(1).max(60).default(5),
    maxAiDecisions: z.coerce.number().int().min(1).max(40).default(16),
    minDecisionGapBars: z.coerce.number().int().min(1).max(60).default(3),
  })
  .superRefine((value, context) => {
    if (value.startTime !== undefined && value.endTime !== undefined && value.startTime >= value.endTime) {
      context.addIssue({ code: "custom", path: ["endTime"], message: "结束时间必须晚于开始时间" });
    }
    if (value.rangeLookback >= value.contextBars) {
      context.addIssue({ code: "custom", path: ["rangeLookback"], message: "区间回看必须小于匿名上下文根数" });
    }
  });

export type AiWyckoffBacktestRequest = z.infer<typeof aiWyckoffBacktestRequestSchema>;
export type AiWyckoffBacktestRequestInput = z.input<typeof aiWyckoffBacktestRequestSchema>;

export type AiWyckoffCandidateReason =
  | "initial_review"
  | "spring_or_shakeout"
  | "upthrust_or_utad"
  | "strength_breakout"
  | "weakness_breakdown"
  | "climactic_action"
  | "low_volume_test";

export interface AiWyckoffDecisionCandidate {
  decisionBarIndex: number;
  barId: string;
  reasons: AiWyckoffCandidateReason[];
}

/** 只含匿名序号和归一化 OHLCV；刻意没有代码、日期、时间戳、成交额或指标。 */
export interface AiWyckoffAnonymousBar {
  barId: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AiWyckoffAnonymousSnapshot {
  asset: "ASSET_001";
  decisionBarId: string;
  priceBase: "DECISION_CLOSE_100";
  volumeBase: "TRAILING_MEDIAN_20_1";
  bars: AiWyckoffAnonymousBar[];
}

export type AiWyckoffPlanStatus =
  | "observed"
  | "waiting_entry"
  | "waiting_exit"
  | "entered"
  | "closed"
  | "invalidated"
  | "expired"
  | "executed"
  | "superseded"
  | "skipped";

export interface AiWyckoffPlan {
  id: string;
  decisionBarIndex: number;
  kind: AiWyckoffPlanKind;
  phase: AiWyckoffPhase;
  event: AiWyckoffDecision["event"];
  action: AiWyckoffAction;
  status: AiWyckoffPlanStatus;
  validFromBarIndex: number;
  validThroughBarIndex: number;
  /** 下列价格均映射到整段回放首根 close=100 的统一匿名坐标。 */
  entryLevel?: number;
  stopLevel?: number;
  targetLevel?: number;
  triggeredBarIndex?: number;
  completedBarIndex?: number;
  linkedTradeId?: string;
  statusReason: string;
  evidence: AiWyckoffEvidence[];
  missingConfirmation: string[];
  invalidation: string[];
  audit: Record<string, unknown>;
}

export type AiWyckoffTradeExitReason =
  | "plan_exit"
  | "stop_loss"
  | "take_profit"
  | "max_holding"
  | "end_of_data";

export interface AiWyckoffTrade {
  id: string;
  planId: string;
  kind: AiWyckoffPlanKind;
  entrySignalBarIndex: number;
  entryBarIndex: number;
  entryPrice: number;
  initialStopLevel: number;
  targetLevel?: number;
  exitSignalBarIndex: number | null;
  exitBarIndex: number;
  exitPrice: number;
  grossPnl: number;
  netPnl: number;
  returnPct: number;
  fees: number;
  holdingBars: number;
  exitReason: AiWyckoffTradeExitReason;
  exitReasonText: string;
  rMultiple: number;
  mfeR: number;
  maeR: number;
}

export interface AiWyckoffReplayBar {
  barIndex: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AiWyckoffCurvePoint {
  barIndex: number;
  equity: number;
  benchmarkEquity: number;
  drawdownPct: number;
  inMarket: boolean;
}

export interface AiWyckoffMetrics {
  totalReturnPct: number;
  benchmarkReturnPct: number;
  excessReturnPct: number;
  maxDrawdownPct: number;
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  profitFactor: number | null;
  averageR: number;
  averageWinR: number;
  averageLossR: number;
  averageMfeR: number;
  averageMaeR: number;
  exposurePct: number;
  totalFees: number;
  planCount: number;
  triggeredPlanCount: number;
  expiredPlanCount: number;
  invalidatedPlanCount: number;
  planExpirationRatePct: number;
  planInvalidationRatePct: number;
  byPlanKind: Partial<Record<AiWyckoffPlanKind, { plans: number; triggered: number; trades: number; winRatePct: number; averageR: number }>>;
}

export interface AiWyckoffReplaySettings {
  period: "1d";
  adjust: AiWyckoffBacktestRequest["adjust"];
  initialCapital: number;
  positionSizePct: number;
  commissionBps: number;
  slippageBps: number;
  maxHoldingBars: number;
  contextBars: number;
  rangeLookback: number;
  planValidBars: number;
  maxAiDecisions: number;
  minDecisionGapBars: number;
}

export interface AiWyckoffReplayAudit {
  dataFingerprint: string;
  suppliedDecisions: number;
  acceptedDecisions: number;
  failedCalls: number;
  cacheHits: number;
  decisionAudits: Array<{ decisionBarIndex: number; audit: Record<string, unknown> }>;
}

export interface AiWyckoffBacktestResult {
  id: string;
  asset: "ASSET_001";
  engineVersion: string;
  settings: AiWyckoffReplaySettings;
  data: {
    barCount: number;
    evaluationStartBarIndex: number;
    evaluationEndBarIndex: number;
  };
  replayBars: AiWyckoffReplayBar[];
  plans: AiWyckoffPlan[];
  trades: AiWyckoffTrade[];
  curve: AiWyckoffCurvePoint[];
  metrics: AiWyckoffMetrics;
  audit: AiWyckoffReplayAudit;
  warnings: string[];
}

export type AiWyckoffBacktestRunStatus = "queued" | "running" | "completed" | "failed";

export interface AiWyckoffBacktestRunSummary {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: AiWyckoffBacktestRunStatus;
  asset: "ASSET_001";
  progressCurrent: number;
  progressTotal: number;
  model: string;
  error?: string;
  metrics?: Pick<
    AiWyckoffMetrics,
    "totalReturnPct" | "maxDrawdownPct" | "tradeCount" | "winRatePct" | "profitFactor" | "averageR" | "planCount"
  >;
}

export interface AiWyckoffBacktestStartResponse {
  runId: string;
  status: AiWyckoffBacktestRunStatus;
}

export interface AiWyckoffBacktestHistoryResponse {
  runs: AiWyckoffBacktestRunSummary[];
}

export interface AiWyckoffBacktestDetailResponse {
  run: AiWyckoffBacktestRunSummary;
  result?: AiWyckoffBacktestResult;
}
