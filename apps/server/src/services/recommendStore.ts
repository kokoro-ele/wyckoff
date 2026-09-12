import type {
  RecommendBookItem,
  RecommendBucket,
  RecommendHistoryItem,
  RecommendRunSummary,
} from "@wyckoff/shared";
import { db } from "../db/index.js";

interface BookRow {
  symbol: string;
  name: string | null;
  bucket: RecommendBucket;
  thesis: string;
  expected_return_pct: number;
  stop_pct: number;
  entry_price: number;
  horizon_days: number;
  conviction: number;
  opened_at: number;
  feature_ms: number | null;
  last_run_id: string | null;
  feature_engine_version: string | null;
  feature_summary: string | null;
  source_note: string | null;
}

interface HistoryRow {
  id: string;
  symbol: string;
  name: string | null;
  bucket: RecommendBucket;
  opened_at: number;
  closed_at: number;
  entry_price: number;
  exit_price: number;
  expected_return_pct: number;
  actual_return_pct: number;
  thesis: string;
  close_reason: string;
}

interface RunRow {
  id: string;
  ran_at: number;
  status: string;
  summary: string;
  email_sent: number;
  payload: string;
}

export function listBook(): RecommendBookItem[] {
  return db
    .prepare<[], BookRow>("SELECT * FROM recommend_book ORDER BY bucket, conviction DESC, opened_at")
    .all()
    .map(toBookItem);
}

export function getBookItem(symbol: string): RecommendBookItem | undefined {
  const row = db.prepare<[string], BookRow>("SELECT * FROM recommend_book WHERE symbol = ?").get(symbol);
  return row ? toBookItem(row) : undefined;
}

export function upsertBook(item: Omit<RecommendBookItem, "lastPrice" | "actualReturnPct">): void {
  db.prepare(`
    INSERT INTO recommend_book (
      symbol, name, bucket, thesis, expected_return_pct, stop_pct, entry_price,
      horizon_days, conviction, opened_at, last_run_id, feature_ms
      , feature_engine_version, feature_summary, source_note
    ) VALUES (
      @symbol, @name, @bucket, @thesis, @expected, @stop, @entry,
      @horizon, @conviction, @opened, @run, @feature
      , @engineVersion, @featureSummary, @sourceNote
    )
    ON CONFLICT(symbol) DO UPDATE SET
      name = excluded.name,
      bucket = excluded.bucket,
      thesis = excluded.thesis,
      expected_return_pct = excluded.expected_return_pct,
      stop_pct = excluded.stop_pct,
      entry_price = excluded.entry_price,
      horizon_days = excluded.horizon_days,
      conviction = excluded.conviction,
      opened_at = excluded.opened_at,
      last_run_id = excluded.last_run_id,
      feature_ms = excluded.feature_ms,
      feature_engine_version = excluded.feature_engine_version,
      feature_summary = excluded.feature_summary,
      source_note = excluded.source_note
  `).run({
    symbol: item.symbol,
    name: item.name,
    bucket: item.bucket,
    thesis: item.thesis,
    expected: item.expectedReturnPct,
    stop: item.stopPct,
    entry: item.entryPrice,
    horizon: item.horizonDays,
    conviction: item.conviction,
    opened: item.openedAt,
    run: item.lastRunId,
    feature: item.featureMs,
    engineVersion: item.featureEngineVersion,
    featureSummary: item.featureSummary,
    sourceNote: item.sourceNote,
  });
}

export function deleteBook(symbol: string): void {
  db.prepare("DELETE FROM recommend_book WHERE symbol = ?").run(symbol);
}

export function insertHistory(item: RecommendHistoryItem): void {
  db.prepare(`
    INSERT INTO recommend_history (
      id, symbol, name, bucket, opened_at, closed_at, entry_price, exit_price,
      expected_return_pct, actual_return_pct, thesis, close_reason
    ) VALUES (
      @id, @symbol, @name, @bucket, @opened, @closed, @entry, @exit,
      @expected, @actual, @thesis, @reason
    )
  `).run({
    id: item.id,
    symbol: item.symbol,
    name: item.name,
    bucket: item.bucket,
    opened: item.openedAt,
    closed: item.closedAt,
    entry: item.entryPrice,
    exit: item.exitPrice,
    expected: item.expectedReturnPct,
    actual: item.actualReturnPct,
    thesis: item.thesis,
    reason: item.closeReason,
  });
}

export function listHistory(limit = 80): RecommendHistoryItem[] {
  return db
    .prepare<[number], HistoryRow>("SELECT * FROM recommend_history ORDER BY closed_at DESC LIMIT ?")
    .all(limit)
    .map((row) => ({
      id: row.id,
      symbol: row.symbol,
      name: row.name,
      bucket: row.bucket,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      entryPrice: row.entry_price,
      exitPrice: row.exit_price,
      expectedReturnPct: row.expected_return_pct,
      actualReturnPct: row.actual_return_pct,
      thesis: row.thesis,
      closeReason: row.close_reason,
    }));
}

export function insertRun(run: RecommendRunSummary): void {
  db.prepare(`
    INSERT INTO recommend_runs (id, ran_at, status, summary, email_sent, payload)
    VALUES (@id, @ran, @status, @summary, @email, @payload)
  `).run({
    id: run.id,
    ran: run.ranAt,
    status: run.status,
    summary: run.summary,
    email: run.emailSent ? 1 : 0,
    payload: JSON.stringify({
      addedWatch: run.addedWatch,
      addedEnter: run.addedEnter,
      dropped: run.dropped,
      upgraded: run.upgraded,
      downgraded: run.downgraded,
      durationMs: run.durationMs,
      featureMs: run.featureMs,
      featureCount: run.featureCount,
      llmMs: run.llmMs,
    }),
  });
}

export function markRunEmailSent(runId: string): void {
  db.prepare("UPDATE recommend_runs SET email_sent = 1 WHERE id = ?").run(runId);
}

export function latestRun(): RecommendRunSummary | null {
  const row = db
    .prepare<[], RunRow>("SELECT * FROM recommend_runs ORDER BY ran_at DESC LIMIT 1")
    .get();
  return row ? toRunSummary(row) : null;
}

export function listRuns(limit = 20): RecommendRunSummary[] {
  return db
    .prepare<[number], RunRow>("SELECT * FROM recommend_runs ORDER BY ran_at DESC LIMIT ?")
    .all(limit)
    .map(toRunSummary);
}

/**
 * 一次成功运行只在所有行情与模型工作结束后落库；推荐簿、历史、运行记录和
 * 两个系统收藏分组共享同一个 SQLite 事务，任何一步失败都会整体回滚。
 */
export const commitSuccessfulRun = db.transaction(
  (input: {
    book: RecommendBookItem[];
    history: RecommendHistoryItem[];
    run: RecommendRunSummary;
    watchGroupId: number;
    enterGroupId: number;
  }): void => {
    db.prepare("DELETE FROM recommend_book").run();
    for (const item of input.book) upsertBook(item);
    for (const item of input.history) insertHistory(item);

    db.prepare("DELETE FROM watch_items WHERE group_id IN (?, ?)").run(input.watchGroupId, input.enterGroupId);
    const addManagedItem = db.prepare(
      "INSERT INTO watch_items (symbol, group_id, sort, added_at) VALUES (?, ?, ?, ?)",
    );
    let watchSort = 0;
    let enterSort = 0;
    const addedAt = Date.now();
    for (const item of input.book) {
      const isEnter = item.bucket === "enter";
      addManagedItem.run(
        item.symbol,
        isEnter ? input.enterGroupId : input.watchGroupId,
        isEnter ? enterSort++ : watchSort++,
        addedAt,
      );
    }

    insertRun(input.run);
  },
);

function toRunSummary(row: RunRow): RecommendRunSummary {
  let extras = {
    addedWatch: [] as string[],
    addedEnter: [] as string[],
    dropped: [] as string[],
    upgraded: [] as string[],
    downgraded: [] as string[],
    durationMs: 0,
    featureMs: 0,
    featureCount: 0,
    llmMs: 0,
  };
  try {
    extras = { ...extras, ...(JSON.parse(row.payload) as typeof extras) };
  } catch {
    /* 旧数据 */
  }
  return {
    id: row.id,
    ranAt: row.ran_at,
    status: row.status as RecommendRunSummary["status"],
    summary: row.summary,
    emailSent: row.email_sent === 1,
    ...extras,
  };
}

function toBookItem(row: BookRow): RecommendBookItem {
  return {
    symbol: row.symbol,
    name: row.name,
    bucket: row.bucket,
    thesis: row.thesis,
    expectedReturnPct: row.expected_return_pct,
    stopPct: row.stop_pct,
    entryPrice: row.entry_price,
    lastPrice: null,
    actualReturnPct: null,
    horizonDays: row.horizon_days,
    conviction: row.conviction,
    openedAt: row.opened_at,
    featureMs: row.feature_ms,
    lastRunId: row.last_run_id,
    featureEngineVersion: row.feature_engine_version,
    featureSummary: row.feature_summary,
    sourceNote: row.source_note,
  };
}
