import type {
  AiWyckoffBacktestResult,
  AiWyckoffBacktestRunStatus,
  AiWyckoffBacktestRunSummary,
} from "@wyckoff/shared";
import { db } from "../db/index.js";

export type AiBacktestRunStatus = AiWyckoffBacktestRunStatus;
export type AiBacktestCallStatus = "completed" | "failed";

interface RunRow {
  id: string;
  created_at: number;
  updated_at: number;
  status: AiBacktestRunStatus;
  symbol: string;
  period: string;
  adjust: string;
  start_time: number | null;
  end_time: number | null;
  progress_current: number;
  progress_total: number;
  model: string;
  prompt_version: string;
  engine_version: string | null;
  request: string;
  result: string | null;
  error: string | null;
}

interface CallRow {
  id: string;
  run_id: string;
  created_at: number;
  as_of_index: number;
  as_of_time: number;
  candidate_key: string;
  status: AiBacktestCallStatus;
  input_hash: string;
  anonymous_input: string;
  raw_output: string | null;
  parsed_output: string | null;
  error: string | null;
  model: string;
  prompt_version: string;
  response_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  duration_ms: number;
  cache_hit: number;
  cached_from_call_id: string | null;
}

export interface AiBacktestRunRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: AiBacktestRunStatus;
  symbol: string;
  period: string;
  adjust: string;
  startTime: number | null;
  endTime: number | null;
  progressCurrent: number;
  progressTotal: number;
  model: string;
  promptVersion: string;
  engineVersion: string | null;
  request: unknown;
  result: unknown | null;
  error: string | null;
}

export interface AiBacktestCallRecord {
  id: string;
  runId: string;
  createdAt: number;
  asOfIndex: number;
  asOfTime: number;
  candidateKey: string;
  status: AiBacktestCallStatus;
  inputHash: string;
  anonymousInput: unknown;
  rawOutput: string | null;
  parsedOutput: unknown | null;
  error: string | null;
  model: string;
  promptVersion: string;
  responseId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationMs: number;
  cacheHit: boolean;
  cachedFromCallId: string | null;
}

export interface CreateAiBacktestRunInput {
  id: string;
  createdAt: number;
  symbol: string;
  period: string;
  adjust: string;
  model: string;
  promptVersion: string;
  request: unknown;
}

export interface SaveAiBacktestCallInput {
  id: string;
  runId: string;
  createdAt: number;
  asOfIndex: number;
  asOfTime: number;
  candidateKey: string;
  status: AiBacktestCallStatus;
  inputHash: string;
  anonymousInput: unknown;
  rawOutput?: string | null;
  parsedOutput?: unknown | null;
  error?: string | null;
  model: string;
  promptVersion: string;
  responseId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  durationMs: number;
  cacheHit?: boolean;
  cachedFromCallId?: string | null;
}

export interface CachedAiBacktestCall {
  id: string;
  rawOutput: string;
  parsedOutput: unknown;
  responseId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

const insertRun = db.prepare(`
  INSERT INTO ai_backtest_runs (
    id, created_at, updated_at, status, symbol, period, adjust,
    model, prompt_version, request
  ) VALUES (
    @id, @createdAt, @createdAt, 'queued', @symbol, @period, @adjust,
    @model, @promptVersion, @request
  )
`);

const insertCall = db.prepare(`
  INSERT INTO ai_backtest_calls (
    id, run_id, created_at, as_of_index, as_of_time, candidate_key, status,
    input_hash, anonymous_input, raw_output, parsed_output, error,
    model, prompt_version, response_id, input_tokens, output_tokens, total_tokens,
    duration_ms, cache_hit, cached_from_call_id
  ) VALUES (
    @id, @runId, @createdAt, @asOfIndex, @asOfTime, @candidateKey, @status,
    @inputHash, @anonymousInput, @rawOutput, @parsedOutput, @error,
    @model, @promptVersion, @responseId, @inputTokens, @outputTokens, @totalTokens,
    @durationMs, @cacheHit, @cachedFromCallId
  )
`);

export function createAiBacktestRun(input: CreateAiBacktestRunInput): void {
  insertRun.run({ ...input, request: JSON.stringify(input.request) });
}

export function markAiBacktestRunning(id: string): boolean {
  return db
    .prepare("UPDATE ai_backtest_runs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'queued'")
    .run(Date.now(), id).changes > 0;
}

export function setAiBacktestRangeAndProgress(id: string, startTime: number, endTime: number, total: number): void {
  db.prepare(`
    UPDATE ai_backtest_runs
    SET start_time = ?, end_time = ?, progress_current = 0, progress_total = ?, updated_at = ?
    WHERE id = ? AND status = 'running'
  `).run(startTime, endTime, total, Date.now(), id);
}

export function updateAiBacktestProgress(id: string, current: number): void {
  db.prepare(`
    UPDATE ai_backtest_runs
    SET progress_current = MIN(progress_total, MAX(0, ?)), updated_at = ?
    WHERE id = ? AND status = 'running'
  `).run(current, Date.now(), id);
}

export function completeAiBacktestRun(id: string, result: unknown, engineVersion: string): boolean {
  return db.prepare(`
    UPDATE ai_backtest_runs
    SET status = 'completed', result = ?, engine_version = ?, error = NULL,
        progress_current = progress_total, updated_at = ?
    WHERE id = ? AND status = 'running'
  `).run(JSON.stringify(result), engineVersion, Date.now(), id).changes > 0;
}

export function failAiBacktestRun(id: string, error: string): boolean {
  return db.prepare(`
    UPDATE ai_backtest_runs
    SET status = 'failed', error = ?, updated_at = ?
    WHERE id = ? AND status IN ('queued', 'running')
  `).run(error, Date.now(), id).changes > 0;
}

/** 进程退出时内存任务不会恢复；启动后把悬空记录明确标为失败。 */
export function failInterruptedAiBacktests(): number {
  return db.prepare(`
    UPDATE ai_backtest_runs
    SET status = 'failed', error = '服务重启，任务已中断', updated_at = ?
    WHERE status IN ('queued', 'running')
  `).run(Date.now()).changes;
}

export function listAiBacktestRuns(limit = 20): AiBacktestRunRecord[] {
  return db
    .prepare<[number], RunRow>("SELECT * FROM ai_backtest_runs ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(limit)
    .map(toRun);
}

export function getAiBacktestRun(id: string): AiBacktestRunRecord | undefined {
  const row = db.prepare<[string], RunRow>("SELECT * FROM ai_backtest_runs WHERE id = ?").get(id);
  return row ? toRun(row) : undefined;
}

export function toAiWyckoffRunSummary(run: AiBacktestRunRecord): AiWyckoffBacktestRunSummary {
  const result = isAiWyckoffResult(run.result) ? run.result : null;
  const metrics = result?.metrics;
  return {
    id: run.id,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    status: run.status,
    asset: "ASSET_001",
    progressCurrent: run.progressCurrent,
    progressTotal: run.progressTotal,
    model: run.model,
    error: run.error ?? undefined,
    metrics: metrics
      ? {
          totalReturnPct: metrics.totalReturnPct,
          maxDrawdownPct: metrics.maxDrawdownPct,
          tradeCount: metrics.tradeCount,
          winRatePct: metrics.winRatePct,
          profitFactor: metrics.profitFactor,
          averageR: metrics.averageR,
          planCount: metrics.planCount,
        }
      : undefined,
  };
}

export function getAiWyckoffResult(run: AiBacktestRunRecord): AiWyckoffBacktestResult | undefined {
  return isAiWyckoffResult(run.result) ? run.result : undefined;
}

export function listAiBacktestCalls(runId: string): AiBacktestCallRecord[] {
  return db
    .prepare<[string], CallRow>(`
      SELECT * FROM ai_backtest_calls
      WHERE run_id = ?
      ORDER BY as_of_index, created_at, id
    `)
    .all(runId)
    .map(toCall);
}

export function saveAiBacktestCall(input: SaveAiBacktestCallInput): void {
  insertCall.run({
    ...input,
    anonymousInput: JSON.stringify(input.anonymousInput),
    rawOutput: input.rawOutput ?? null,
    parsedOutput: input.parsedOutput == null ? null : JSON.stringify(input.parsedOutput),
    error: input.error ?? null,
    responseId: input.responseId ?? null,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    totalTokens: input.totalTokens ?? null,
    cacheHit: input.cacheHit ? 1 : 0,
    cachedFromCallId: input.cachedFromCallId ?? null,
  });
}

export function findCachedAiBacktestCall(
  inputHash: string,
  model: string,
  promptVersion: string,
): CachedAiBacktestCall | undefined {
  const row = db.prepare<[string, string, string], CallRow>(`
    SELECT * FROM ai_backtest_calls
    WHERE input_hash = ? AND model = ? AND prompt_version = ?
      AND status = 'completed' AND parsed_output IS NOT NULL AND raw_output IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 1
  `).get(inputHash, model, promptVersion);
  if (!row || row.raw_output === null || row.parsed_output === null) return undefined;
  return {
    id: row.id,
    rawOutput: row.raw_output,
    parsedOutput: parseJson(row.parsed_output),
    responseId: row.response_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
  };
}

export type DeleteAiBacktestResult = "deleted" | "not_found" | "not_terminal";

export const deleteAiBacktestRun = db.transaction((id: string): DeleteAiBacktestResult => {
  const row = db.prepare<[string], { status: AiBacktestRunStatus }>("SELECT status FROM ai_backtest_runs WHERE id = ?").get(id);
  if (!row) return "not_found";
  if (row.status === "queued" || row.status === "running") return "not_terminal";
  db.prepare("DELETE FROM ai_backtest_runs WHERE id = ?").run(id);
  return "deleted";
});

function toRun(row: RunRow): AiBacktestRunRecord {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    symbol: row.symbol,
    period: row.period,
    adjust: row.adjust,
    startTime: row.start_time,
    endTime: row.end_time,
    progressCurrent: row.progress_current,
    progressTotal: row.progress_total,
    model: row.model,
    promptVersion: row.prompt_version,
    engineVersion: row.engine_version,
    request: parseJson(row.request),
    result: row.result === null ? null : parseJson(row.result),
    error: row.error,
  };
}

function toCall(row: CallRow): AiBacktestCallRecord {
  return {
    id: row.id,
    runId: row.run_id,
    createdAt: row.created_at,
    asOfIndex: row.as_of_index,
    asOfTime: row.as_of_time,
    candidateKey: row.candidate_key,
    status: row.status,
    inputHash: row.input_hash,
    anonymousInput: parseJson(row.anonymous_input),
    rawOutput: row.raw_output,
    parsedOutput: row.parsed_output === null ? null : parseJson(row.parsed_output),
    error: row.error,
    model: row.model,
    promptVersion: row.prompt_version,
    responseId: row.response_id,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    totalTokens: row.total_tokens,
    durationMs: row.duration_ms,
    cacheHit: row.cache_hit === 1,
    cachedFromCallId: row.cached_from_call_id,
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isAiWyckoffResult(value: unknown): value is AiWyckoffBacktestResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<AiWyckoffBacktestResult>;
  return (
    candidate.asset === "ASSET_001" &&
    typeof candidate.engineVersion === "string" &&
    typeof candidate.metrics === "object" &&
    candidate.metrics !== null &&
    Array.isArray(candidate.plans) &&
    Array.isArray(candidate.trades)
  );
}
