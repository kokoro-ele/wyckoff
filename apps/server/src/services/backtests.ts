import type { BacktestResult, BacktestRunSummary } from "@wyckoff/shared";
import { db } from "../db/index.js";

interface BacktestRunRow {
  id: string;
  created_at: number;
  symbol: string;
  period: BacktestRunSummary["period"];
  adjust: BacktestRunSummary["adjust"];
  strategy: BacktestRunSummary["strategy"];
  strategy_name: string;
  start_time: number;
  end_time: number;
  total_return_pct: number;
  benchmark_return_pct: number;
  max_drawdown_pct: number;
  trade_count: number;
}

interface BacktestResultRow {
  result: string;
}

const insertRun = db.prepare(`
  INSERT INTO backtest_runs (
    id, created_at, symbol, period, adjust, strategy, strategy_name, engine_version,
    start_time, end_time, total_return_pct, benchmark_return_pct,
    max_drawdown_pct, trade_count, request, result
  ) VALUES (
    @id, @createdAt, @symbol, @period, @adjust, @strategy, @strategyName, @engineVersion,
    @startTime, @endTime, @totalReturnPct, @benchmarkReturnPct,
    @maxDrawdownPct, @tradeCount, @request, @result
  )
`);

/**
 * 回测先在内存里完整完成，再一次性写入。这样失败的计算不会留下半条曲线，
 * 历史列表与详情也始终指向同一个不可变结果快照。
 */
export function saveBacktest(result: BacktestResult): void {
  insertRun.run({
    id: result.id,
    createdAt: result.createdAt,
    symbol: result.request.symbol,
    period: result.request.period,
    adjust: result.request.adjust,
    strategy: result.request.strategy.type,
    strategyName: result.strategyName,
    engineVersion: result.engineVersion,
    startTime: result.data.startTime,
    endTime: result.data.endTime,
    totalReturnPct: result.metrics.totalReturnPct,
    benchmarkReturnPct: result.metrics.benchmarkReturnPct,
    maxDrawdownPct: result.metrics.maxDrawdownPct,
    tradeCount: result.metrics.tradeCount,
    request: JSON.stringify(result.request),
    result: JSON.stringify(result),
  });
}

export function listBacktests(limit = 20): BacktestRunSummary[] {
  return db
    .prepare<[number], BacktestRunRow>(`
      SELECT id, created_at, symbol, period, adjust, strategy, strategy_name,
             start_time, end_time, total_return_pct, benchmark_return_pct,
             max_drawdown_pct, trade_count
      FROM backtest_runs
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `)
    .all(limit)
    .map(toSummary);
}

export function getBacktest(id: string): BacktestResult | undefined {
  const row = db.prepare<[string], BacktestResultRow>("SELECT result FROM backtest_runs WHERE id = ?").get(id);
  return row ? (JSON.parse(row.result) as BacktestResult) : undefined;
}

export function deleteBacktest(id: string): boolean {
  return db.prepare("DELETE FROM backtest_runs WHERE id = ?").run(id).changes > 0;
}

function toSummary(row: BacktestRunRow): BacktestRunSummary {
  return {
    id: row.id,
    createdAt: row.created_at,
    symbol: row.symbol,
    period: row.period,
    adjust: row.adjust,
    strategy: row.strategy,
    strategyName: row.strategy_name,
    startTime: row.start_time,
    endTime: row.end_time,
    totalReturnPct: row.total_return_pct,
    benchmarkReturnPct: row.benchmark_return_pct,
    maxDrawdownPct: row.max_drawdown_pct,
    tradeCount: row.trade_count,
  };
}
