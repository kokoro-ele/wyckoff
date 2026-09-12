import {
  aiWyckoffBacktestRequestSchema,
  aiWyckoffDecisionSchema,
  type AiWyckoffAnonymousSnapshot,
  type AiWyckoffBacktestRequest,
  type AiWyckoffBacktestRequestInput,
  type AiWyckoffBacktestResult,
  type AiWyckoffCandidateReason,
  type AiWyckoffCurvePoint,
  type AiWyckoffDecision,
  type AiWyckoffDecisionCandidate,
  type AiWyckoffDecisionInput,
  type AiWyckoffMetrics,
  type AiWyckoffPlan,
  type AiWyckoffReplayBar,
  type AiWyckoffTrade,
  type AiWyckoffTradeExitReason,
} from "@wyckoff/shared";
import { BacktestInputError } from "./backtest.js";
import type { Kline } from "./types.js";

export const AI_WYCKOFF_BACKTEST_ENGINE_VERSION = "1.0.0";

const BPS_DIVISOR = 10_000;
const PRICE_NORMALIZATION = 100;
const VOLUME_LOOKBACK = 20;
const EPSILON = 1e-10;

export interface ScanAiWyckoffDecisionCandidatesInput {
  request: AiWyckoffBacktestRequest | AiWyckoffBacktestRequestInput;
  klines: Kline[];
}

export interface BuildAiWyckoffAnonymousSnapshotInput {
  klines: Kline[];
  decisionBarIndex: number;
  contextBars: number;
}

export interface RunAiWyckoffPlanBacktestInput {
  request: AiWyckoffBacktestRequest | AiWyckoffBacktestRequestInput;
  klines: Kline[];
  decisions: Array<AiWyckoffDecision | AiWyckoffDecisionInput>;
  id?: string;
}

interface EvaluationWindow {
  startIndex: number;
  endIndex: number;
}

interface WaitingEntry {
  plan: AiWyckoffPlan;
  entryPrice: number;
  stopPrice: number;
  targetPrice?: number;
}

interface OpenPosition {
  plan: AiWyckoffPlan;
  quantity: number;
  entrySignalBarIndex: number;
  entryBarIndex: number;
  entryPrice: number;
  entryFee: number;
  initialStopPrice: number;
  stopPrice: number;
  targetPrice?: number;
  highestPrice: number;
  lowestPrice: number;
}

interface PendingExit {
  signalBarIndex: number;
  reason: AiWyckoffTradeExitReason;
  reasonText: string;
  plan?: AiWyckoffPlan;
}

/** 全历史零基下标到匿名、稳定的 BAR_000001 编号。 */
export function aiWyckoffBarId(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new BacktestInputError("INVALID_REQUEST", "匿名 K 线下标必须是非负安全整数");
  }
  return `BAR_${String(index + 1).padStart(6, "0")}`;
}

/**
 * 只按时间从左到右扫描已经收盘的数据。候选是否成立只取决于该根及其之前的
 * OHLCV；按时间先到先得截断 maxAiDecisions，因此追加未来数据不会重排旧候选。
 */
export function scanAiWyckoffDecisionCandidates({
  request: rawRequest,
  klines,
}: ScanAiWyckoffDecisionCandidatesInput): AiWyckoffDecisionCandidate[] {
  const request = parseRequest(rawRequest);
  validateBars(klines);
  const window = selectEvaluationWindow(klines, request);
  const scanStart = Math.max(window.startIndex, request.rangeLookback, VOLUME_LOOKBACK);
  if (scanStart > window.endIndex) return [];

  const candidates: AiWyckoffDecisionCandidate[] = [];
  let lastAccepted = Number.NEGATIVE_INFINITY;

  const accept = (index: number, reasons: AiWyckoffCandidateReason[]): void => {
    if (reasons.length === 0 || candidates.length >= request.maxAiDecisions) return;
    if (index - lastAccepted < request.minDecisionGapBars) return;
    candidates.push({ decisionBarIndex: index, barId: aiWyckoffBarId(index), reasons });
    lastAccepted = index;
  };

  accept(scanStart, ["initial_review"]);

  for (let i = scanStart + 1; i <= window.endIndex && candidates.length < request.maxAiDecisions; i++) {
    const current = klines[i];
    const range = klines.slice(i - request.rangeLookback, i);
    const referenceSupport = Math.min(...range.map((bar) => bar.low));
    const referenceResistance = Math.max(...range.map((bar) => bar.high));
    const height = referenceResistance - referenceSupport;
    const mid = (referenceResistance + referenceSupport) / 2;
    const rangeEfficiency = efficiencyRatio(range.map((bar) => bar.close));
    const rangeLike = height > 0 && mid > 0 && rangeEfficiency <= 0.5 && height / mid >= 0.01;
    const prior = klines.slice(i - VOLUME_LOOKBACK, i);
    const baselineVolume = positiveMedian(prior.map((bar) => bar.volume));
    const baselineSpread = positiveMedian(prior.map((bar) => bar.high - bar.low));
    const spread = current.high - current.low;
    const volumeRatio = baselineVolume > 0 ? current.volume / baselineVolume : current.volume > 0 ? 1 : 0;
    const spreadRatio = baselineSpread > 0 ? spread / baselineSpread : 1;
    const closePosition = spread > 0 ? (current.close - current.low) / spread : 0.5;
    const reasons: AiWyckoffCandidateReason[] = [];

    if (rangeLike && current.low < referenceSupport && current.close > referenceSupport) {
      reasons.push("spring_or_shakeout");
    }
    if (rangeLike && current.high > referenceResistance && current.close < referenceResistance) {
      reasons.push("upthrust_or_utad");
    }
    if (
      rangeLike &&
      current.close > referenceResistance &&
      volumeRatio >= 1.2 &&
      spreadRatio >= 1.1 &&
      closePosition >= 0.6
    ) {
      reasons.push("strength_breakout");
    }
    if (
      rangeLike &&
      current.close < referenceSupport &&
      volumeRatio >= 1.2 &&
      spreadRatio >= 1.1 &&
      closePosition <= 0.4
    ) {
      reasons.push("weakness_breakdown");
    }
    if (volumeRatio >= 2 && (spreadRatio >= 1.35 || spreadRatio <= 0.7)) {
      reasons.push("climactic_action");
    }
    if (
      rangeLike &&
      volumeRatio <= 0.65 &&
      spreadRatio <= 0.85 &&
      (current.low <= referenceSupport + height * 0.3 || current.high >= referenceResistance - height * 0.3)
    ) {
      reasons.push("low_volume_test");
    }

    accept(i, unique(reasons));
  }

  return candidates;
}

/**
 * 构造给模型的唯一行情载荷。价格以决策根收盘=100，成交量以各根之前 20 根的
 * 中位数=1；对象中没有 symbol、真实日期、timestamp、amount、均线或任何指标字段。
 */
export function buildAiWyckoffAnonymousSnapshot({
  klines,
  decisionBarIndex,
  contextBars,
}: BuildAiWyckoffAnonymousSnapshotInput): AiWyckoffAnonymousSnapshot {
  validateBars(klines);
  if (!Number.isSafeInteger(decisionBarIndex) || decisionBarIndex < 0 || decisionBarIndex >= klines.length) {
    throw new BacktestInputError("INVALID_REQUEST", "decisionBarIndex 不在行情范围内");
  }
  if (!Number.isSafeInteger(contextBars) || contextBars < 1 || contextBars > 300) {
    throw new BacktestInputError("INVALID_REQUEST", "contextBars 必须是 1 到 300 的整数");
  }

  const start = Math.max(0, decisionBarIndex - contextBars + 1);
  const decisionClose = klines[decisionBarIndex].close;
  const bars = klines.slice(start, decisionBarIndex + 1).map((bar, offset) => {
    const index = start + offset;
    const volumeStart = Math.max(0, index - VOLUME_LOOKBACK);
    const baselineVolume = positiveMedian(klines.slice(volumeStart, index).map((item) => item.volume));
    return {
      barId: aiWyckoffBarId(index),
      open: round((bar.open / decisionClose) * PRICE_NORMALIZATION, 4),
      high: round((bar.high / decisionClose) * PRICE_NORMALIZATION, 4),
      low: round((bar.low / decisionClose) * PRICE_NORMALIZATION, 4),
      close: round((bar.close / decisionClose) * PRICE_NORMALIZATION, 4),
      volume: round(baselineVolume > 0 ? bar.volume / baselineVolume : bar.volume > 0 ? 1 : 0, 4),
    };
  });

  return {
    asset: "ASSET_001",
    decisionBarId: aiWyckoffBarId(decisionBarIndex),
    priceBase: "DECISION_CLOSE_100",
    volumeBase: "TRAILING_MEDIAN_20_1",
    bars,
  };
}

/**
 * 回放已经生成并通过 schema 校验的 AI 决策。模型不参与撮合：计划何时生效、
 * stop-buy、止损/止盈、T+1、费用、滑点和最长持有期均由这里确定性执行。
 */
export function runAiWyckoffPlanBacktest({
  request: rawRequest,
  klines,
  decisions: rawDecisions,
  id,
}: RunAiWyckoffPlanBacktestInput): AiWyckoffBacktestResult {
  const request = parseRequest(rawRequest);
  validateBars(klines);
  const evaluation = selectEvaluationWindow(klines, request);
  const decisions = parseAndValidateDecisions(rawDecisions, request, klines, evaluation);
  const decisionsByBar = new Map(decisions.map((decision) => [decision.decisionBarIndex, decision]));
  const runId = id ?? createRunId();
  const plans: AiWyckoffPlan[] = [];
  const trades: AiWyckoffTrade[] = [];
  const curve: AiWyckoffCurvePoint[] = [];
  const warnings: string[] = [];
  const replayBase = klines[evaluation.startIndex].close;
  const commissionRate = request.commissionBps / BPS_DIVISOR;
  const slippageRate = request.slippageBps / BPS_DIVISOR;
  const usesTPlusOne = isMainlandAshare(request.symbol);

  let cash = request.initialCapital;
  let waitingEntry: WaitingEntry | null = null;
  let position: OpenPosition | null = null;
  let pendingExit: PendingExit | null = null;
  let peakEquity = request.initialCapital;
  let totalFees = 0;
  let forcedEndOfData = false;
  let ignoredLastDecision = false;

  const globalPrice = (rawPrice: number): number => round((rawPrice / replayBase) * PRICE_NORMALIZATION, 6);

  const closePosition = (
    barIndex: number,
    rawExitPrice: number,
    reason: AiWyckoffTradeExitReason,
    reasonText: string,
    exitSignalBarIndex: number | null,
    exitPlan?: AiWyckoffPlan,
  ): void => {
    if (!position) return;
    const held = position;
    const exitPrice = adverseFillPrice(rawExitPrice, "sell", slippageRate);
    const exitNotional = exitPrice * held.quantity;
    const exitFee = exitNotional * commissionRate;
    cash += exitNotional - exitFee;
    totalFees += exitFee;

    const grossPnl = (exitPrice - held.entryPrice) * held.quantity;
    const fees = held.entryFee + exitFee;
    const netPnl = grossPnl - fees;
    const entryCost = held.entryPrice * held.quantity + held.entryFee;
    const riskPerShare = Math.max(held.entryPrice - held.initialStopPrice, held.entryPrice * 1e-6);
    const riskAmount = riskPerShare * held.quantity;
    const tradeId = `${runId}-trade-${trades.length + 1}`;
    const trade: AiWyckoffTrade = {
      id: tradeId,
      planId: held.plan.id,
      kind: held.plan.kind,
      entrySignalBarIndex: held.entrySignalBarIndex,
      entryBarIndex: held.entryBarIndex,
      entryPrice: globalPrice(held.entryPrice),
      initialStopLevel: globalPrice(held.initialStopPrice),
      targetLevel: held.targetPrice === undefined ? undefined : globalPrice(held.targetPrice),
      exitSignalBarIndex,
      exitBarIndex: barIndex,
      exitPrice: globalPrice(exitPrice),
      grossPnl: round(grossPnl, 2),
      netPnl: round(netPnl, 2),
      returnPct: round(entryCost > 0 ? (netPnl / entryCost) * 100 : 0, 4),
      fees: round(fees, 2),
      holdingBars: Math.max(1, barIndex - held.entryBarIndex + 1),
      exitReason: reason,
      exitReasonText: reasonText,
      rMultiple: round(riskAmount > 0 ? netPnl / riskAmount : 0, 4),
      mfeR: round((held.highestPrice - held.entryPrice) / riskPerShare, 4),
      maeR: round((held.lowestPrice - held.entryPrice) / riskPerShare, 4),
    };
    trades.push(trade);
    held.plan.status = "closed";
    held.plan.completedBarIndex = barIndex;
    held.plan.linkedTradeId = tradeId;
    held.plan.statusReason = reasonText;
    if (exitPlan) {
      exitPlan.status = "executed";
      exitPlan.triggeredBarIndex = barIndex;
      exitPlan.completedBarIndex = barIndex;
      exitPlan.linkedTradeId = tradeId;
      exitPlan.statusReason = reasonText;
    }
    position = null;
  };

  for (let i = evaluation.startIndex; i <= evaluation.endIndex; i++) {
    const bar = klines[i];
    const isLastBar = i === evaluation.endIndex;

    // 昨日收盘产生的离场信号，今日开盘优先执行。
    if (pendingExit) {
      if (position) {
        closePosition(i, bar.open, pendingExit.reason, pendingExit.reasonText, pendingExit.signalBarIndex, pendingExit.plan);
      } else if (pendingExit.plan) {
        pendingExit.plan.status = "skipped";
        pendingExit.plan.completedBarIndex = i;
        pendingExit.plan.statusReason = "执行时已无持仓";
      }
      pendingExit = null;
    }

    // 计划入场条件从决策根的下一根开始生效，是一张有效期有限的 stop-buy。
    if (!position && waitingEntry && i >= waitingEntry.plan.validFromBarIndex) {
      const waiting: WaitingEntry = waitingEntry;
      // 最后一根即使触发也没有后续路径可验证；不制造同根开平仓。
      const hitEntry = !isLastBar && (bar.open >= waiting.entryPrice || bar.high >= waiting.entryPrice);
      if (hitEntry) {
        const rawEntryPrice = bar.open >= waiting.entryPrice ? bar.open : waiting.entryPrice;
        const entryPrice = adverseFillPrice(rawEntryPrice, "buy", slippageRate);
        const budget = cash * (request.positionSizePct / 100);
        const quantity = budget / (entryPrice * (1 + commissionRate));
        if (quantity > EPSILON) {
          const entryNotional = entryPrice * quantity;
          const entryFee = entryNotional * commissionRate;
          cash -= entryNotional + entryFee;
          if (Math.abs(cash) < EPSILON) cash = 0;
          totalFees += entryFee;
          waiting.plan.status = "entered";
          waiting.plan.triggeredBarIndex = i;
          waiting.plan.statusReason = bar.open >= waiting.entryPrice ? "开盘越过 stop-buy 触发" : "盘中触及 stop-buy 触发";
          position = {
            plan: waiting.plan,
            quantity,
            entrySignalBarIndex: waiting.plan.decisionBarIndex,
            entryBarIndex: i,
            entryPrice,
            entryFee,
            initialStopPrice: waiting.stopPrice,
            stopPrice: waiting.stopPrice,
            targetPrice: waiting.targetPrice,
            highestPrice: Math.max(entryPrice, bar.high),
            lowestPrice: Math.min(entryPrice, bar.low),
          };
          waitingEntry = null;
        }
      } else if (bar.low <= waiting.stopPrice) {
        waiting.plan.status = "invalidated";
        waiting.plan.completedBarIndex = i;
        waiting.plan.statusReason = "入场前先跌破结构失效位";
        waitingEntry = null;
      } else if (i >= waiting.plan.validThroughBarIndex) {
        waiting.plan.status = "expired";
        waiting.plan.completedBarIndex = i;
        waiting.plan.statusReason = "有效期内未触发入场";
        waitingEntry = null;
      }
    }

    // 入场后更新最大有利/不利波动，并按日线 OHLC 的保守顺序处理风控。
    if (position) {
      position.highestPrice = Math.max(position.highestPrice, bar.high);
      position.lowestPrice = Math.min(position.lowestPrice, bar.low);
      if (!(usesTPlusOne && position.entryBarIndex === i)) {
        const hitStop = bar.low <= position.stopPrice;
        const hitTarget = position.targetPrice !== undefined && bar.high >= position.targetPrice;
        if (bar.open <= position.stopPrice) {
          closePosition(i, bar.open, "stop_loss", "开盘跳空跌破结构止损位", i);
        } else if (position.targetPrice !== undefined && bar.open >= position.targetPrice) {
          closePosition(i, position.targetPrice, "take_profit", "开盘越过结构目标，按目标价保守成交", i);
        } else if (hitStop) {
          closePosition(
            i,
            position.stopPrice,
            "stop_loss",
            hitTarget ? "同根同时触及结构止损与目标，按保守规则先止损" : "盘中触及结构止损位",
            i,
          );
        } else if (hitTarget && position.targetPrice !== undefined) {
          closePosition(i, position.targetPrice, "take_profit", "盘中触及结构目标", i);
        }
      }
    }

    if (position && i - position.entryBarIndex + 1 >= request.maxHoldingBars && !isLastBar) {
      pendingExit = {
        signalBarIndex: i,
        reason: "max_holding",
        reasonText: `持有已达上限 ${request.maxHoldingBars} 根 K 线`,
      };
    }

    const decision = decisionsByBar.get(i);
    if (decision) {
      if (decision.action === "enter_long" && waitingEntry) {
        waitingEntry.plan.status = "superseded";
        waitingEntry.plan.completedBarIndex = i;
        waitingEntry.plan.statusReason = `被 ${aiWyckoffBarId(i)} 的新计划替代`;
        waitingEntry = null;
      }

      const plan = createPlan(decision, request, klines, replayBase, plans.length + 1, evaluation.endIndex);
      plans.push(plan);

      if (decision.action === "observe") {
        plan.status = "observed";
        plan.completedBarIndex = i;
        plan.statusReason = "仅观察，未创建订单";
      } else if (decision.action === "enter_long") {
        if (position) {
          plan.status = "skipped";
          plan.completedBarIndex = i;
          plan.statusReason = "已有持仓，单标的回放不叠加仓位";
        } else if (isLastBar) {
          plan.status = "expired";
          plan.completedBarIndex = i;
          plan.statusReason = "决策后没有下一根 K 线可执行";
          ignoredLastDecision = true;
        } else {
          const decisionClose: number = klines[i].close;
          waitingEntry = {
            plan,
            entryPrice: decisionClose * (decision.entryLevel! / PRICE_NORMALIZATION),
            stopPrice: decisionClose * (decision.stopLevel! / PRICE_NORMALIZATION),
            targetPrice:
              decision.targetLevel === undefined
                ? undefined
                : decisionClose * (decision.targetLevel / PRICE_NORMALIZATION),
          };
          plan.status = "waiting_entry";
          plan.statusReason = "等待下一根起触发 stop-buy";
        }
      } else if (!position) {
        plan.status = "skipped";
        plan.completedBarIndex = i;
        plan.statusReason = "当前没有多头持仓可退出";
      } else if (isLastBar) {
        plan.status = "skipped";
        plan.completedBarIndex = i;
        plan.statusReason = "离场信号后没有下一根开盘可执行";
        ignoredLastDecision = true;
      } else if (pendingExit) {
        plan.status = "skipped";
        plan.completedBarIndex = i;
        plan.statusReason = "已有更早的离场订单等待执行";
      } else {
        plan.status = "waiting_exit";
        plan.statusReason = "等待下一根开盘执行离场";
        pendingExit = {
          signalBarIndex: i,
          reason: "plan_exit",
          reasonText: `${decision.kind} 计划触发离场`,
          plan,
        };
      }
    }

    if (isLastBar) {
      if (waitingEntry) {
        waitingEntry.plan.status = "expired";
        waitingEntry.plan.completedBarIndex = i;
        waitingEntry.plan.statusReason = "数据结束前未触发入场";
        waitingEntry = null;
      }
      if (position) {
        closePosition(i, bar.close, "end_of_data", "数据结束，按最后一根收盘价结算", null);
        forcedEndOfData = true;
      }
      if (pendingExit?.plan) {
        pendingExit.plan.status = "skipped";
        pendingExit.plan.completedBarIndex = i;
        pendingExit.plan.statusReason = "数据结束前没有下一根开盘";
      }
      pendingExit = null;
    }

    const equity = cash + (position ? position.quantity * bar.close : 0);
    peakEquity = Math.max(peakEquity, equity);
    curve.push({
      barIndex: i,
      equity: round(equity, 2),
      benchmarkEquity: round(request.initialCapital * (bar.close / replayBase), 2),
      drawdownPct: round(peakEquity > 0 ? ((equity - peakEquity) / peakEquity) * 100 : 0, 4),
      inMarket: position !== null,
    });
  }

  if (usesTPlusOne) warnings.push("已按沪深京股票 T+1 模拟：买入当根不允许退出，风控从下一根 K 线生效。");
  if (forcedEndOfData) warnings.push("数据结束时仍有持仓，已按末根收盘价（含卖出滑点和佣金）结算。");
  if (ignoredLastDecision) warnings.push("末根决策没有下一根 K 线可供执行，已记录为过期或跳过。");
  if (trades.length === 0) warnings.push("所选区间内没有形成完整交易。");
  if (decisions.length === 0) warnings.push("没有提供落在评估区间内的 AI 决策。");
  warnings.push("日线 OHLC 无法确定同根内价格路径；同时触及入场、止损或目标时采用保守顺序。");

  const replayBars = buildReplayBars(klines, evaluation, replayBase);
  const metrics = computeMetrics(request, curve, plans, trades, totalFees);
  assertFiniteResult(replayBars, curve, trades, metrics);

  return {
    id: runId,
    asset: "ASSET_001",
    engineVersion: AI_WYCKOFF_BACKTEST_ENGINE_VERSION,
    settings: {
      period: request.period,
      adjust: request.adjust,
      initialCapital: request.initialCapital,
      positionSizePct: request.positionSizePct,
      commissionBps: request.commissionBps,
      slippageBps: request.slippageBps,
      maxHoldingBars: request.maxHoldingBars,
      contextBars: request.contextBars,
      rangeLookback: request.rangeLookback,
      planValidBars: request.planValidBars,
      maxAiDecisions: request.maxAiDecisions,
      minDecisionGapBars: request.minDecisionGapBars,
    },
    data: {
      barCount: evaluation.endIndex - evaluation.startIndex + 1,
      evaluationStartBarIndex: evaluation.startIndex,
      evaluationEndBarIndex: evaluation.endIndex,
    },
    replayBars,
    plans,
    trades,
    curve,
    metrics,
    audit: {
      dataFingerprint: fingerprintOhlcv(klines.slice(evaluation.startIndex, evaluation.endIndex + 1)),
      suppliedDecisions: rawDecisions.length,
      acceptedDecisions: decisions.length,
      failedCalls: 0,
      cacheHits: decisions.filter((decision) => decision.audit.cacheHit === true).length,
      decisionAudits: decisions.map((decision) => ({ decisionBarIndex: decision.decisionBarIndex, audit: decision.audit })),
    },
    warnings,
  };
}

function createPlan(
  decision: AiWyckoffDecision,
  request: AiWyckoffBacktestRequest,
  klines: Kline[],
  replayBase: number,
  ordinal: number,
  evaluationEnd: number,
): AiWyckoffPlan {
  const decisionClose = klines[decision.decisionBarIndex].close;
  const toGlobal = (level: number | undefined): number | undefined =>
    level === undefined
      ? undefined
      : round(((decisionClose * (level / PRICE_NORMALIZATION)) / replayBase) * PRICE_NORMALIZATION, 6);
  const isEntry = decision.action === "enter_long";
  return {
    id: `plan-${String(ordinal).padStart(4, "0")}`,
    decisionBarIndex: decision.decisionBarIndex,
    kind: decision.kind,
    phase: decision.phase,
    event: decision.event,
    action: decision.action,
    status: decision.action === "observe" ? "observed" : "waiting_entry",
    validFromBarIndex: isEntry ? decision.decisionBarIndex + 1 : decision.decisionBarIndex,
    validThroughBarIndex: isEntry
      ? Math.min(evaluationEnd, decision.decisionBarIndex + request.planValidBars)
      : decision.decisionBarIndex,
    entryLevel: toGlobal(decision.entryLevel),
    stopLevel: toGlobal(decision.stopLevel),
    targetLevel: toGlobal(decision.targetLevel),
    statusReason: "计划已创建",
    evidence: decision.evidence,
    missingConfirmation: decision.missingConfirmation,
    invalidation: decision.invalidation,
    audit: decision.audit,
  };
}

function parseRequest(input: AiWyckoffBacktestRequest | AiWyckoffBacktestRequestInput): AiWyckoffBacktestRequest {
  const parsed = aiWyckoffBacktestRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new BacktestInputError("INVALID_REQUEST", parsed.error.issues.map((issue) => issue.message).join("；"), {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function parseAndValidateDecisions(
  inputs: Array<AiWyckoffDecision | AiWyckoffDecisionInput>,
  request: AiWyckoffBacktestRequest,
  klines: Kline[],
  evaluation: EvaluationWindow,
): AiWyckoffDecision[] {
  if (inputs.length > request.maxAiDecisions) {
    throw new BacktestInputError("INVALID_REQUEST", `AI 决策数 ${inputs.length} 超过上限 ${request.maxAiDecisions}`);
  }
  const decisions = inputs.map((input, index) => {
    const parsed = aiWyckoffDecisionSchema.safeParse(input);
    if (!parsed.success) {
      throw new BacktestInputError(
        "INVALID_REQUEST",
        `第 ${index + 1} 个 AI 决策无效：${parsed.error.issues.map((issue) => issue.message).join("；")}`,
        { cause: parsed.error },
      );
    }
    return parsed.data;
  });
  decisions.sort((a, b) => a.decisionBarIndex - b.decisionBarIndex);

  for (let i = 0; i < decisions.length; i++) {
    const decision = decisions[i];
    if (decision.decisionBarIndex < evaluation.startIndex || decision.decisionBarIndex > evaluation.endIndex) {
      throw new BacktestInputError("INVALID_REQUEST", "AI 决策下标必须落在评估区间内");
    }
    if (i > 0) {
      const gap = decision.decisionBarIndex - decisions[i - 1].decisionBarIndex;
      if (gap < request.minDecisionGapBars) {
        throw new BacktestInputError("INVALID_REQUEST", `相邻 AI 决策必须至少间隔 ${request.minDecisionGapBars} 根 K 线`);
      }
    }
    const contextStart = Math.max(0, decision.decisionBarIndex - request.contextBars + 1);
    for (const evidence of decision.evidence) {
      const evidenceIndex = parseBarId(evidence.barId);
      if (evidenceIndex < contextStart || evidenceIndex > decision.decisionBarIndex || evidenceIndex >= klines.length) {
        throw new BacktestInputError(
          "INVALID_REQUEST",
          `${evidence.barId} 不在 ${aiWyckoffBarId(decision.decisionBarIndex)} 的匿名上下文内`,
        );
      }
    }
  }
  return decisions;
}

function validateBars(klines: Kline[]): void {
  if (klines.length === 0) throw new BacktestInputError("NO_DATA", "没有可供回放的 K 线数据");
  for (let i = 0; i < klines.length; i++) {
    const bar = klines[i];
    if (
      !Number.isSafeInteger(bar.timestamp) ||
      bar.timestamp <= 0 ||
      ![bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) ||
      bar.open <= 0 ||
      bar.high <= 0 ||
      bar.low <= 0 ||
      bar.close <= 0 ||
      bar.volume < 0 ||
      bar.high < Math.max(bar.open, bar.close) ||
      bar.low > Math.min(bar.open, bar.close) ||
      bar.low > bar.high
    ) {
      throw new BacktestInputError("INVALID_DATA", `第 ${i + 1} 根 K 线的 OHLCV 非法`);
    }
    if (i > 0 && bar.timestamp <= klines[i - 1].timestamp) {
      throw new BacktestInputError("INVALID_DATA", "K 线必须按时间戳严格递增且不能重复");
    }
  }
}

function selectEvaluationWindow(klines: Kline[], request: AiWyckoffBacktestRequest): EvaluationWindow {
  const startIndex =
    request.startTime === undefined ? 0 : klines.findIndex((bar) => bar.timestamp >= request.startTime!);
  if (startIndex < 0) throw new BacktestInputError("NO_DATA", "所选时间范围内没有 K 线数据");
  let endIndex = klines.length - 1;
  if (request.endTime !== undefined) {
    while (endIndex >= startIndex && klines[endIndex].timestamp > request.endTime) endIndex--;
  }
  if (endIndex < startIndex) throw new BacktestInputError("NO_DATA", "所选时间范围内没有 K 线数据");
  return { startIndex, endIndex };
}

function buildReplayBars(klines: Kline[], evaluation: EvaluationWindow, replayBase: number): AiWyckoffReplayBar[] {
  const output: AiWyckoffReplayBar[] = [];
  for (let i = evaluation.startIndex; i <= evaluation.endIndex; i++) {
    const bar = klines[i];
    const baselineVolume = positiveMedian(klines.slice(Math.max(0, i - VOLUME_LOOKBACK), i).map((item) => item.volume));
    output.push({
      barIndex: i,
      open: round((bar.open / replayBase) * PRICE_NORMALIZATION, 6),
      high: round((bar.high / replayBase) * PRICE_NORMALIZATION, 6),
      low: round((bar.low / replayBase) * PRICE_NORMALIZATION, 6),
      close: round((bar.close / replayBase) * PRICE_NORMALIZATION, 6),
      volume: round(baselineVolume > 0 ? bar.volume / baselineVolume : bar.volume > 0 ? 1 : 0, 4),
    });
  }
  return output;
}

function computeMetrics(
  request: AiWyckoffBacktestRequest,
  curve: AiWyckoffCurvePoint[],
  plans: AiWyckoffPlan[],
  trades: AiWyckoffTrade[],
  totalFees: number,
): AiWyckoffMetrics {
  const finalEquity = curve[curve.length - 1].equity;
  const benchmarkEquity = curve[curve.length - 1].benchmarkEquity;
  const winning = trades.filter((trade) => trade.netPnl > 0);
  const losing = trades.filter((trade) => trade.netPnl < 0);
  const grossProfit = winning.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(losing.reduce((sum, trade) => sum + trade.netPnl, 0));
  const entryPlans = plans.filter((plan) => plan.action === "enter_long");
  const triggeredPlans = plans.filter((plan) => plan.triggeredBarIndex !== undefined);
  const expiredPlans = entryPlans.filter((plan) => plan.status === "expired");
  const invalidatedPlans = entryPlans.filter((plan) => plan.status === "invalidated");
  const byPlanKind: AiWyckoffMetrics["byPlanKind"] = {};

  for (const kind of new Set(plans.map((plan) => plan.kind))) {
    const kindPlans = plans.filter((plan) => plan.kind === kind);
    const kindTrades = trades.filter((trade) => trade.kind === kind);
    const kindWins = kindTrades.filter((trade) => trade.netPnl > 0).length;
    byPlanKind[kind] = {
      plans: kindPlans.length,
      triggered: kindPlans.filter((plan) => plan.triggeredBarIndex !== undefined).length,
      trades: kindTrades.length,
      winRatePct: round(kindTrades.length > 0 ? (kindWins / kindTrades.length) * 100 : 0, 2),
      averageR: round(kindTrades.length > 0 ? mean(kindTrades.map((trade) => trade.rMultiple)) : 0, 4),
    };
  }

  return {
    totalReturnPct: round(((finalEquity / request.initialCapital) - 1) * 100, 4),
    benchmarkReturnPct: round(((benchmarkEquity / request.initialCapital) - 1) * 100, 4),
    excessReturnPct: round(((finalEquity - benchmarkEquity) / request.initialCapital) * 100, 4),
    maxDrawdownPct: round(Math.abs(Math.min(0, ...curve.map((point) => point.drawdownPct))), 4),
    tradeCount: trades.length,
    winningTrades: winning.length,
    losingTrades: losing.length,
    winRatePct: round(trades.length > 0 ? (winning.length / trades.length) * 100 : 0, 2),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 4) : null,
    averageR: round(trades.length > 0 ? mean(trades.map((trade) => trade.rMultiple)) : 0, 4),
    averageWinR: round(winning.length > 0 ? mean(winning.map((trade) => trade.rMultiple)) : 0, 4),
    averageLossR: round(losing.length > 0 ? mean(losing.map((trade) => trade.rMultiple)) : 0, 4),
    averageMfeR: round(trades.length > 0 ? mean(trades.map((trade) => trade.mfeR)) : 0, 4),
    averageMaeR: round(trades.length > 0 ? mean(trades.map((trade) => trade.maeR)) : 0, 4),
    exposurePct: round(
      Math.min(1, trades.reduce((sum, trade) => sum + trade.holdingBars, 0) / Math.max(1, curve.length)) * 100,
      2,
    ),
    totalFees: round(totalFees, 2),
    planCount: plans.length,
    triggeredPlanCount: triggeredPlans.length,
    expiredPlanCount: expiredPlans.length,
    invalidatedPlanCount: invalidatedPlans.length,
    planExpirationRatePct: round(entryPlans.length > 0 ? (expiredPlans.length / entryPlans.length) * 100 : 0, 2),
    planInvalidationRatePct: round(entryPlans.length > 0 ? (invalidatedPlans.length / entryPlans.length) * 100 : 0, 2),
    byPlanKind,
  };
}

function assertFiniteResult(
  replayBars: AiWyckoffReplayBar[],
  curve: AiWyckoffCurvePoint[],
  trades: AiWyckoffTrade[],
  metrics: AiWyckoffMetrics,
): void {
  const replayValues = replayBars.flatMap((bar) => [bar.barIndex, bar.open, bar.high, bar.low, bar.close, bar.volume]);
  const curveValues = curve.flatMap((point) => [point.barIndex, point.equity, point.benchmarkEquity, point.drawdownPct]);
  const tradeValues = trades.flatMap((trade) => [
    trade.entrySignalBarIndex,
    trade.entryBarIndex,
    trade.entryPrice,
    trade.initialStopLevel,
    trade.exitBarIndex,
    trade.exitPrice,
    trade.grossPnl,
    trade.netPnl,
    trade.returnPct,
    trade.fees,
    trade.holdingBars,
    trade.rMultiple,
    trade.mfeR,
    trade.maeR,
  ]);
  const metricValues = Object.entries(metrics)
    .filter(([key]) => key !== "byPlanKind")
    .map(([, value]) => value)
    .filter((value): value is number => typeof value === "number");
  if (![...replayValues, ...curveValues, ...tradeValues, ...metricValues].every(Number.isFinite)) {
    throw new BacktestInputError("INVALID_DATA", "行情数值导致匿名回放结果溢出");
  }
}

function parseBarId(barId: string): number {
  const value = Number(barId.slice(4));
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new BacktestInputError("INVALID_REQUEST", `匿名 K 线编号无效：${barId}`);
  }
  return value - 1;
}

function isMainlandAshare(symbol: string): boolean {
  return /\.(?:SH|SZ|BJ)$/i.test(symbol);
}

function adverseFillPrice(rawPrice: number, side: "buy" | "sell", slippageRate: number): number {
  return rawPrice * (side === "buy" ? 1 + slippageRate : 1 - slippageRate);
}

function positiveMedian(values: number[]): number {
  const finite = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (finite.length === 0) return 0;
  const mid = Math.floor(finite.length / 2);
  return finite.length % 2 === 0 ? (finite[mid - 1] + finite[mid]) / 2 : finite[mid];
}

function efficiencyRatio(values: number[]): number {
  if (values.length < 2) return 0;
  const displacement = Math.abs(values[values.length - 1] - values[0]);
  let path = 0;
  for (let i = 1; i < values.length; i++) path += Math.abs(values[i] - values[i - 1]);
  return path > 0 ? displacement / path : 0;
}

function fingerprintOhlcv(bars: Kline[]): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (const bar of bars) {
    const encoded = `${bar.open}|${bar.high}|${bar.low}|${bar.close}|${bar.volume};`;
    for (let i = 0; i < encoded.length; i++) {
      const code = encoded.charCodeAt(i);
      left = Math.imul(left ^ code, 0x01000193);
      right = Math.imul(right ^ code, 0x85ebca6b);
    }
  }
  return `ohlcv-v1:${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function createRunId(): string {
  return `aibt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
