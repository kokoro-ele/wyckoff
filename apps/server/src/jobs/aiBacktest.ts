import {
  aiWyckoffBacktestRequestSchema,
  makeId,
  type AiWyckoffBacktestRequest,
  type AiWyckoffBacktestStartResponse,
  type AiWyckoffDecision,
} from "@wyckoff/shared";
import {
  AI_WYCKOFF_BACKTEST_ENGINE_VERSION,
  buildAiWyckoffAnonymousSnapshot,
  runAiWyckoffPlanBacktest,
  scanAiWyckoffDecisionCandidates,
} from "@wyckoff/wyckoff";
import { config } from "../config.js";
import { getKlines } from "../services/market.js";
import {
  completeAiBacktestRun,
  createAiBacktestRun,
  failAiBacktestRun,
  failInterruptedAiBacktests,
  markAiBacktestRunning,
  setAiBacktestRangeAndProgress,
  updateAiBacktestProgress,
} from "../services/aiBacktests.js";
import { AI_WYCKOFF_PROMPT_VERSION, analyzeWyckoffCandidate } from "../services/wyckoffPlanLlm.js";

const MAX_BACKTEST_BARS = 50_000;

let activeRunId: string | null = null;

/**
 * 创建独立后台任务。全进程只允许一个 AI 历史回放，避免模型调用与行情请求挤占
 * 交互式分析；每个候选仍严格按时间顺序、单独上下文执行。
 */
export function queueAiWyckoffBacktest(rawRequest: AiWyckoffBacktestRequest): AiWyckoffBacktestStartResponse | null {
  if (activeRunId !== null) return null;
  const request = aiWyckoffBacktestRequestSchema.parse(rawRequest);
  const runId = makeId("aibt");
  const createdAt = Date.now();
  createAiBacktestRun({
    id: runId,
    createdAt,
    symbol: request.symbol,
    period: request.period,
    adjust: request.adjust,
    model: config.llm.model,
    promptVersion: AI_WYCKOFF_PROMPT_VERSION,
    request,
  });
  activeRunId = runId;
  void executeAiWyckoffBacktest(runId, request);
  return { runId, status: "queued" };
}

export function isAiWyckoffBacktestRunning(): boolean {
  return activeRunId !== null;
}

/** 启动时调用一次；进程内任务无法跨重启恢复，明确终止而不是永远显示运行中。 */
export function recoverInterruptedAiWyckoffBacktests(): number {
  return failInterruptedAiBacktests();
}

async function executeAiWyckoffBacktest(runId: string, request: AiWyckoffBacktestRequest): Promise<void> {
  try {
    if (!markAiBacktestRunning(runId)) throw new Error("AI 回测任务状态异常，无法开始");
    const klines = await getKlines({
      symbol: request.symbol,
      period: request.period,
      adjust: request.adjust,
    });
    if (klines.length > MAX_BACKTEST_BARS) {
      throw new Error(`当前历史包含 ${klines.length} 根 K 线，单次 AI 回测最多支持 ${MAX_BACKTEST_BARS} 根`);
    }

    const candidates = scanAiWyckoffDecisionCandidates({ request, klines });
    const first = evaluationBoundary(klines, request.startTime, "start");
    const last = evaluationBoundary(klines, request.endTime, "end");
    setAiBacktestRangeAndProgress(runId, first.timestamp, last.timestamp, candidates.length);

    const decisions: AiWyckoffDecision[] = [];
    let failedCalls = 0;
    let cacheHits = 0;
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      const snapshot = buildAiWyckoffAnonymousSnapshot({
        klines,
        decisionBarIndex: candidate.decisionBarIndex,
        contextBars: request.contextBars,
      });
      const analyzed = await analyzeWyckoffCandidate({
        runId,
        candidate,
        snapshot,
        // 只进入服务端审计表，永远不进入 anonymousInput 或模型 prompt。
        asOfTime: klines[candidate.decisionBarIndex].timestamp,
      });
      if (analyzed.decision) decisions.push(analyzed.decision);
      else failedCalls++;
      if (analyzed.cacheHit) cacheHits++;
      updateAiBacktestProgress(runId, index + 1);
    }

    const result = runAiWyckoffPlanBacktest({ id: runId, request, klines, decisions });
    result.audit.failedCalls = failedCalls;
    result.audit.cacheHits = cacheHits;
    if (failedCalls > 0) {
      result.warnings.unshift(`${failedCalls} 个候选的模型调用或协议校验失败；这些时点没有生成交易计划，也没有重试采样。`);
    }
    if (candidates.length >= request.maxAiDecisions) {
      result.warnings.unshift(`候选数量达到上限 ${request.maxAiDecisions}；结果按时间先到先得截断，未挑选收益更好的历史片段。`);
    }
    if (!completeAiBacktestRun(runId, result, AI_WYCKOFF_BACKTEST_ENGINE_VERSION)) {
      throw new Error("AI 回测结果写入失败");
    }
  } catch (error) {
    failAiBacktestRun(runId, safeErrorMessage(error));
    console.error(`[ai-backtest] ${runId} 失败：`, error);
  } finally {
    if (activeRunId === runId) activeRunId = null;
  }
}

function evaluationBoundary(
  klines: Awaited<ReturnType<typeof getKlines>>,
  timestamp: number | undefined,
  side: "start" | "end",
) {
  if (klines.length === 0) throw new Error("没有可供回测的 K 线数据");
  if (timestamp === undefined) return side === "start" ? klines[0] : klines[klines.length - 1];
  if (side === "start") {
    const found = klines.find((bar) => bar.timestamp >= timestamp);
    if (!found) throw new Error("所选时间范围内没有 K 线数据");
    return found;
  }
  for (let index = klines.length - 1; index >= 0; index--) {
    if (klines[index].timestamp <= timestamp) return klines[index];
  }
  throw new Error("所选时间范围内没有 K 线数据");
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error && error.message ? error.message : "AI Wyckoff 回测失败";
  return message.slice(0, 2_000);
}
