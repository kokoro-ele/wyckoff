import { createHash } from "node:crypto";
import {
  AI_WYCKOFF_ACTIONS,
  AI_WYCKOFF_PHASES,
  AI_WYCKOFF_PLAN_KINDS,
  WYCKOFF_EVENTS,
  aiWyckoffDecisionSchema,
  aiWyckoffEvidenceSchema,
  makeId,
  type AiWyckoffAnonymousSnapshot,
  type AiWyckoffDecision,
  type AiWyckoffDecisionCandidate,
  wyckoffEventCodeSchema,
} from "@wyckoff/shared";
import { z } from "zod";
import { config } from "../config.js";
import { completeJson, extractJson, type JsonCompletionMetadata } from "../llm/complete.js";
import {
  findCachedAiBacktestCall,
  saveAiBacktestCall,
} from "./aiBacktests.js";

export const AI_WYCKOFF_PROMPT_VERSION = "wyckoff-plan-v1";

const modelDecisionSchema = z
  .object({
    kind: z.enum(AI_WYCKOFF_PLAN_KINDS),
    phase: z.enum(AI_WYCKOFF_PHASES),
    event: wyckoffEventCodeSchema.nullable(),
    action: z.enum(AI_WYCKOFF_ACTIONS),
    entryLevel: z.number().finite().positive().max(10_000).optional(),
    stopLevel: z.number().finite().positive().max(10_000).optional(),
    targetLevel: z.number().finite().positive().max(10_000).optional(),
    evidence: z.array(aiWyckoffEvidenceSchema).min(1).max(16),
    missingConfirmation: z.array(z.string().trim().min(1).max(240)).max(12),
    invalidation: z.array(z.string().trim().min(1).max(240)).max(12),
  })
  .strict();

const SYSTEM_PROMPT = `你是一个严格的匿名单资产 Wyckoff 量价判读器。

你唯一可以使用的事实是输入 JSON 的匿名日线 OHLCV。不得使用或猜测股票代码、名称、市场、日期、新闻、财报、行业、指数、相对强弱、ATR、均线或任何技术指标。不得联网。不得把形态联想到现实标的。

只按 Wyckoff 的供求、因果、努力与结果、Phase A-E 以及 PS/SC/AR/ST/Spring/Shakeout/Test/SOS/LPS/JAC/BU/PSY/BC/UT/UTAD/SOW/LPSY/ICE 判读。只做多；证据不足时必须输出 observe，不能硬凑阶段或事件。

输入的最后一根是当前已收盘 K 线，不存在未来数据。价格以当前决策根 close=100 归一化，成交量是相对近 20 根中位数；BAR 编号只是顺序标签。

仅输出一个 JSON 对象，字段必须且只能是：
{
  "kind":"observe|spring_test_long|sos_lps_long|reaccumulation_long|ut_utad_exit|sow_lpsy_exit",
  "phase":"A|B|C|D|E|unknown",
  "event":"PS|SC|AR|ST|Spring|Shakeout|Test|SOS|LPS|JAC|BU|PSY|BC|UT|UTAD|SOW|LPSY|ICE|null",
  "action":"enter_long|exit_long|observe",
  "entryLevel":101.2,
  "stopLevel":96.8,
  "targetLevel":112.0,
  "evidence":[{"barId":"BAR_000001","observation":"仅描述该根 K 线的价差、收盘位置、相对量和区间行为"}],
  "missingConfirmation":[],
  "invalidation":[]
}

observe 或 exit_long 不需要的价格字段应省略。enter_long 必须给 entryLevel 与 stopLevel，且 stopLevel < entryLevel；targetLevel 若给出必须高于 entryLevel。Spring/Test、SOS/LPS、再吸筹做多才可 enter_long；UT/UTAD 或 SOW/LPSY 只可 exit_long。所有证据必须引用输入中真实存在的 BAR 编号。不要输出 markdown。`;

export interface AnalyzeWyckoffCandidateInput {
  runId: string;
  candidate: AiWyckoffDecisionCandidate;
  snapshot: AiWyckoffAnonymousSnapshot;
  asOfTime: number;
}

export interface AnalyzeWyckoffCandidateResult {
  callId: string;
  decision: AiWyckoffDecision | null;
  cacheHit: boolean;
}

/**
 * 每个候选独立调用一次模型。任何请求或解析失败只留下 failed 审计记录并返回 null，
 * 不重试、不合成交易决策，避免失败路径产生不可解释的交易或额外采样。
 */
export async function analyzeWyckoffCandidate(
  input: AnalyzeWyckoffCandidateInput,
): Promise<AnalyzeWyckoffCandidateResult> {
  assertSnapshotMatchesCandidate(input.snapshot, input.candidate);
  const callId = makeId("aic");
  const createdAt = Date.now();
  const anonymousInput = input.snapshot;
  const serializedInput = JSON.stringify(anonymousInput);
  const inputHash = hashPromptAndInput(serializedInput, config.llm.model);
  const candidateKey = `${input.candidate.barId}:${[...input.candidate.reasons].sort().join(",")}`;

  const cached = findCachedAiBacktestCall(inputHash, config.llm.model, AI_WYCKOFF_PROMPT_VERSION);
  if (cached) {
    const cachedDecision = validateStoredDecision(cached.parsedOutput, input.candidate, input.snapshot);
    if (cachedDecision) {
      const decision = withAudit(cachedDecision, {
        callId,
        model: config.llm.model,
        promptVersion: AI_WYCKOFF_PROMPT_VERSION,
        inputHash,
        cacheHit: true,
        cachedFromCallId: cached.id,
        responseId: cached.responseId,
        inputTokens: cached.inputTokens,
        outputTokens: cached.outputTokens,
        totalTokens: cached.totalTokens,
        durationMs: 0,
      });
      saveAiBacktestCall({
        id: callId,
        runId: input.runId,
        createdAt,
        asOfIndex: input.candidate.decisionBarIndex,
        asOfTime: input.asOfTime,
        candidateKey,
        status: "completed",
        inputHash,
        anonymousInput,
        rawOutput: cached.rawOutput,
        parsedOutput: decision,
        model: config.llm.model,
        promptVersion: AI_WYCKOFF_PROMPT_VERSION,
        responseId: cached.responseId,
        inputTokens: cached.inputTokens,
        outputTokens: cached.outputTokens,
        totalTokens: cached.totalTokens,
        durationMs: 0,
        cacheHit: true,
        cachedFromCallId: cached.id,
      });
      return { callId, decision, cacheHit: true };
    }
  }

  const startedAt = Date.now();
  let rawOutput: string | null = null;
  const metadata: { value: JsonCompletionMetadata | null } = { value: null };
  try {
    rawOutput = await completeJson({
      instructions: SYSTEM_PROMPT,
      input: serializedInput,
      webSearch: false,
      onComplete: (value) => {
        metadata.value = value;
      },
    });
    const durationMs = Date.now() - startedAt;
    const parsed = parseAiWyckoffModelDecision(rawOutput, input.candidate, input.snapshot);
    const decision = withAudit(parsed, {
      callId,
      model: config.llm.model,
      responseModel: metadata.value?.model ?? null,
      promptVersion: AI_WYCKOFF_PROMPT_VERSION,
      inputHash,
      cacheHit: false,
      responseId: metadata.value?.responseId ?? null,
      inputTokens: metadata.value?.inputTokens ?? null,
      outputTokens: metadata.value?.outputTokens ?? null,
      totalTokens: metadata.value?.totalTokens ?? null,
      durationMs,
    });
    saveAiBacktestCall({
      id: callId,
      runId: input.runId,
      createdAt,
      asOfIndex: input.candidate.decisionBarIndex,
      asOfTime: input.asOfTime,
      candidateKey,
      status: "completed",
      inputHash,
      anonymousInput,
      rawOutput,
      parsedOutput: decision,
      model: config.llm.model,
      promptVersion: AI_WYCKOFF_PROMPT_VERSION,
      responseId: metadata.value?.responseId ?? null,
      inputTokens: metadata.value?.inputTokens ?? null,
      outputTokens: metadata.value?.outputTokens ?? null,
      totalTokens: metadata.value?.totalTokens ?? null,
      durationMs,
    });
    return { callId, decision, cacheHit: false };
  } catch (error) {
    saveAiBacktestCall({
      id: callId,
      runId: input.runId,
      createdAt,
      asOfIndex: input.candidate.decisionBarIndex,
      asOfTime: input.asOfTime,
      candidateKey,
      status: "failed",
      inputHash,
      anonymousInput,
      rawOutput,
      error: safeErrorMessage(error),
      model: config.llm.model,
      promptVersion: AI_WYCKOFF_PROMPT_VERSION,
      responseId: metadata.value?.responseId ?? null,
      inputTokens: metadata.value?.inputTokens ?? null,
      outputTokens: metadata.value?.outputTokens ?? null,
      totalTokens: metadata.value?.totalTokens ?? null,
      durationMs: Date.now() - startedAt,
    });
    return { callId, decision: null, cacheHit: false };
  }
}

export function parseAiWyckoffModelDecision(
  text: string,
  candidate: AiWyckoffDecisionCandidate,
  snapshot: AiWyckoffAnonymousSnapshot,
): AiWyckoffDecision {
  const modelParsed = modelDecisionSchema.safeParse(extractJson<unknown>(text));
  if (!modelParsed.success) {
    throw new Error(`模型计划 JSON 不符合协议：${modelParsed.error.issues[0]?.message ?? "未知错误"}`);
  }
  const decisionParsed = aiWyckoffDecisionSchema.safeParse({
    ...modelParsed.data,
    decisionBarIndex: candidate.decisionBarIndex,
    audit: {},
  });
  if (!decisionParsed.success) {
    throw new Error(`模型计划不符合交易约束：${decisionParsed.error.issues[0]?.message ?? "未知错误"}`);
  }
  assertEvidenceReferences(decisionParsed.data, snapshot);
  assertPureWyckoffSemantics(decisionParsed.data);
  return decisionParsed.data;
}

function validateStoredDecision(
  value: unknown,
  candidate: AiWyckoffDecisionCandidate,
  snapshot: AiWyckoffAnonymousSnapshot,
): AiWyckoffDecision | null {
  const parsed = aiWyckoffDecisionSchema.safeParse(value);
  if (!parsed.success || parsed.data.decisionBarIndex !== candidate.decisionBarIndex) return null;
  try {
    assertEvidenceReferences(parsed.data, snapshot);
    assertPureWyckoffSemantics(parsed.data);
    return parsed.data;
  } catch {
    return null;
  }
}

function assertSnapshotMatchesCandidate(
  snapshot: AiWyckoffAnonymousSnapshot,
  candidate: AiWyckoffDecisionCandidate,
): void {
  if (snapshot.decisionBarId !== candidate.barId) throw new Error("匿名快照与决策候选不匹配");
  if (snapshot.asset !== "ASSET_001") throw new Error("匿名快照资产代号无效");
  if (snapshot.bars.length === 0 || snapshot.bars[snapshot.bars.length - 1]?.barId !== candidate.barId) {
    throw new Error("匿名快照必须截止于候选 K 线");
  }
}

function assertEvidenceReferences(decision: AiWyckoffDecision, snapshot: AiWyckoffAnonymousSnapshot): void {
  const allowed = new Set(snapshot.bars.map((bar) => bar.barId));
  for (const evidence of decision.evidence) {
    if (!allowed.has(evidence.barId)) throw new Error(`证据引用了匿名窗口外的 K 线 ${evidence.barId}`);
  }
}

const EXTERNAL_CONTEXT_PATTERN =
  /新闻|财报|公告|公司|行业|指数|大盘|基本面|政策|宏观|代码|股票名|日期|星期|均线|移动平均|MACD|RSI|KDJ|BOLL|ATR|news|earnings|fundamental|ticker|symbol|moving average/i;
const CALENDAR_DATE_PATTERN = /\b(?:19|20)\d{2}[-/.年]\d{1,2}/;

function assertPureWyckoffSemantics(decision: AiWyckoffDecision): void {
  const text = [
    ...decision.evidence.map((item) => item.observation),
    ...decision.missingConfirmation,
    ...decision.invalidation,
  ].join("\n");
  if (EXTERNAL_CONTEXT_PATTERN.test(text) || CALENDAR_DATE_PATTERN.test(text)) {
    throw new Error("模型计划引用了 OHLCV 与 Wyckoff 之外的信息");
  }

  if (decision.event && decision.phase !== "unknown") {
    const phases = WYCKOFF_EVENTS[decision.event].phases;
    if (!phases.includes(decision.phase)) {
      throw new Error(`${decision.event} 与 Phase ${decision.phase} 不一致`);
    }
  }

  const event = decision.event;
  if (decision.kind === "spring_test_long" && event && !["Spring", "Shakeout", "Test"].includes(event)) {
    throw new Error("Spring/Test 做多计划引用了不一致的 Wyckoff 事件");
  }
  if (
    (decision.kind === "sos_lps_long" || decision.kind === "reaccumulation_long") &&
    event &&
    !["SOS", "LPS", "JAC", "BU", "Test"].includes(event)
  ) {
    throw new Error("SOS/LPS 或再吸筹计划引用了不一致的 Wyckoff 事件");
  }
  if (decision.kind === "ut_utad_exit" && event && !["PSY", "BC", "UT", "UTAD"].includes(event)) {
    throw new Error("UT/UTAD 退出计划引用了不一致的 Wyckoff 事件");
  }
  if (decision.kind === "sow_lpsy_exit" && event && !["SOW", "LPSY", "ICE"].includes(event)) {
    throw new Error("SOW/LPSY 退出计划引用了不一致的 Wyckoff 事件");
  }

  if (decision.action === "enter_long") {
    const entry = decision.entryLevel!;
    const stop = decision.stopLevel!;
    const target = decision.targetLevel;
    if (entry < 50 || entry > 200 || stop < 40 || entry - stop > 40) {
      throw new Error("模型计划价格超出匿名坐标的安全范围");
    }
    if (target !== undefined && (target > 250 || target - entry > 100)) {
      throw new Error("模型目标价格超出匿名坐标的安全范围");
    }
  }
}

function withAudit(decision: AiWyckoffDecision, audit: Record<string, unknown>): AiWyckoffDecision {
  return { ...decision, audit: { ...decision.audit, ...audit } };
}

function hashPromptAndInput(serializedInput: string, model: string): string {
  return createHash("sha256")
    .update(AI_WYCKOFF_PROMPT_VERSION)
    .update("\0")
    .update(model)
    .update("\0")
    .update(serializedInput)
    .digest("hex");
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "模型调用失败";
  return message.slice(0, 1_000);
}
