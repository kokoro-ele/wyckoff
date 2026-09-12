import { z } from "zod";
import { adjustTypeSchema, periodSchema, type AdjustType, type Period } from "./market.js";

export const backtestStrategySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ma_cross"),
    fastPeriod: z.coerce.number().int().min(2).max(200).default(20),
    slowPeriod: z.coerce.number().int().min(3).max(500).default(60),
  }),
  z.object({
    type: z.literal("wyckoff_breakout"),
    rangeLookback: z.coerce.number().int().min(10).max(250).default(40),
    maxRangeEfficiency: z.coerce.number().min(0.05).max(1).default(0.35),
    breakoutBufferPct: z.coerce.number().min(0).max(5).default(0.3),
    volumeLookback: z.coerce.number().int().min(5).max(100).default(20),
    volumeMultiplier: z.coerce.number().min(0.1).max(10).default(1.2),
  }),
]);

export type BacktestStrategy = z.infer<typeof backtestStrategySchema>;

export const backtestRequestSchema = z
  .object({
    symbol: z.string().trim().min(1).max(32),
    period: periodSchema.default("1d"),
    adjust: adjustTypeSchema.default("forward"),
    startTime: z.coerce.number().int().positive().optional(),
    endTime: z.coerce.number().int().positive().optional(),
    initialCapital: z.coerce.number().finite().min(1_000).max(1_000_000_000).default(100_000),
    positionSizePct: z.coerce.number().min(1).max(100).default(100),
    commissionBps: z.coerce.number().min(0).max(100).default(5),
    slippageBps: z.coerce.number().min(0).max(100).default(5),
    stopLossPct: z.coerce.number().min(0.1).max(50).default(8),
    takeProfitPct: z.coerce.number().min(0.1).max(200).default(20),
    maxHoldingBars: z.coerce.number().int().min(1).max(2_000).default(120),
    strategy: backtestStrategySchema,
  })
  .superRefine((value, context) => {
    if (value.startTime !== undefined && value.endTime !== undefined && value.startTime >= value.endTime) {
      context.addIssue({ code: "custom", path: ["endTime"], message: "结束时间必须晚于开始时间" });
    }
    if (value.strategy.type === "ma_cross" && value.strategy.fastPeriod >= value.strategy.slowPeriod) {
      context.addIssue({ code: "custom", path: ["strategy", "fastPeriod"], message: "快线周期必须小于慢线周期" });
    }
  });

export type BacktestRequest = z.infer<typeof backtestRequestSchema>;
export type BacktestRequestInput = z.input<typeof backtestRequestSchema>;

export type BacktestExitReason =
  | "strategy_signal"
  | "stop_loss"
  | "take_profit"
  | "max_holding"
  | "end_of_data";

export interface BacktestTrade {
  id: string;
  side: "long";
  entrySignalTime: number;
  entryTime: number;
  entryPrice: number;
  exitSignalTime: number | null;
  exitTime: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  netPnl: number;
  returnPct: number;
  fees: number;
  holdingBars: number;
  exitReason: BacktestExitReason;
  entryReason: string;
  exitReasonText: string;
}

export interface BacktestCurvePoint {
  timestamp: number;
  equity: number;
  benchmarkEquity: number;
  drawdownPct: number;
  inMarket: boolean;
}

export interface BacktestMetrics {
  totalReturnPct: number;
  benchmarkReturnPct: number;
  excessReturnPct: number;
  /** 区间短于 30 个自然日时不展示不稳定的年化值。 */
  annualizedReturnPct: number | null;
  annualizedVolatilityPct: number | null;
  sharpeRatio: number | null;
  maxDrawdownPct: number;
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  winRatePct: number;
  profitFactor: number | null;
  averageTradePct: number;
  averageHoldingBars: number;
  exposurePct: number;
  totalFees: number;
}

export interface BacktestDataSummary {
  barCount: number;
  startTime: number;
  endTime: number;
  /** 策略为产生首个有效信号所需的历史根数。 */
  warmupBars: number;
  /** 在评估开始日期之前实际取得、且只用于指标预热的根数。 */
  actualWarmupBars: number;
  /** 行情来源说明；旧版历史结果可能缺失。 */
  source?: string;
  /** 覆盖预热与评估窗口的 OHLCV 内容指纹，用于发现数据修订。 */
  fingerprint?: string;
}

export interface BacktestResult {
  id: string;
  createdAt: number;
  engineVersion: string;
  strategyName: string;
  strategyDescription: string;
  request: BacktestRequest;
  data: BacktestDataSummary;
  metrics: BacktestMetrics;
  curve: BacktestCurvePoint[];
  trades: BacktestTrade[];
  warnings: string[];
}

export interface BacktestRunSummary {
  id: string;
  createdAt: number;
  symbol: string;
  period: Period;
  adjust: AdjustType;
  strategy: BacktestStrategy["type"];
  strategyName: string;
  startTime: number;
  endTime: number;
  totalReturnPct: number;
  benchmarkReturnPct: number;
  maxDrawdownPct: number;
  tradeCount: number;
}

export interface BacktestHistoryResponse {
  runs: BacktestRunSummary[];
}
