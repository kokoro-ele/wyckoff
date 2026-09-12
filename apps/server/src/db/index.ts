import Database from "better-sqlite3";
import { config } from "../config.js";

export const db = new Database(config.dbPath);

db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");

db.exec(`
  -- 标的元数据。首次启动时从 TickFlow 拉取五个交易所的全量清单。
  CREATE TABLE IF NOT EXISTS instruments (
    symbol      TEXT PRIMARY KEY,
    exchange    TEXT NOT NULL,
    code        TEXT NOT NULL,
    name        TEXT,
    region      TEXT NOT NULL,
    type        TEXT,
    -- 拼音检索列，入库时预生成：full 是全拼，initials 是首字母
    pinyin_full TEXT NOT NULL DEFAULT '',
    pinyin_abbr TEXT NOT NULL DEFAULT '',
    ext         TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_instruments_code ON instruments(code);
  CREATE INDEX IF NOT EXISTS idx_instruments_name ON instruments(name);
  CREATE INDEX IF NOT EXISTS idx_instruments_abbr ON instruments(pinyin_abbr);

  -- K 线缓存。免费档的日线是收盘后才更新的历史数据，很适合长期缓存。
  CREATE TABLE IF NOT EXISTS klines (
    symbol    TEXT NOT NULL,
    period    TEXT NOT NULL,
    adjust    TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    open      REAL NOT NULL,
    high      REAL NOT NULL,
    low       REAL NOT NULL,
    close     REAL NOT NULL,
    volume    REAL NOT NULL,
    amount    REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (symbol, period, adjust, timestamp)
  );

  -- 每个 (标的,周期,复权) 组合的缓存状态，用来决定是否需要回源。
  CREATE TABLE IF NOT EXISTS kline_meta (
    symbol       TEXT NOT NULL,
    period       TEXT NOT NULL,
    adjust       TEXT NOT NULL,
    first_time   INTEGER NOT NULL,
    last_time    INTEGER NOT NULL,
    fetched_at   INTEGER NOT NULL,
    PRIMARY KEY (symbol, period, adjust)
  );

  CREATE TABLE IF NOT EXISTS watch_groups (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    managed_key TEXT
  );

  CREATE TABLE IF NOT EXISTS watch_items (
    symbol   TEXT NOT NULL,
    group_id INTEGER NOT NULL REFERENCES watch_groups(id) ON DELETE CASCADE,
    sort     INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (symbol, group_id)
  );

  -- 分析会话：一个标的上的一段对话。
  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    symbol     TEXT NOT NULL,
    period     TEXT NOT NULL,
    title      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_symbol ON sessions(symbol);

  CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    tool_trace TEXT,
    context    TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

  -- 标注分组：一次分析产出的整套标注共享一个 group。
  CREATE TABLE IF NOT EXISTS annotation_groups (
    group_id   TEXT PRIMARY KEY,
    symbol     TEXT NOT NULL,
    period     TEXT NOT NULL,
    title      TEXT NOT NULL,
    visible    INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_annotation_groups_symbol ON annotation_groups(symbol, period);

  CREATE TABLE IF NOT EXISTS annotations (
    id       TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES annotation_groups(group_id) ON DELETE CASCADE,
    symbol   TEXT NOT NULL,
    period   TEXT NOT NULL,
    source   TEXT NOT NULL DEFAULT 'agent',
    payload  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_annotations_group ON annotations(group_id);
  CREATE INDEX IF NOT EXISTS idx_annotations_symbol ON annotations(symbol, period);

  CREATE TABLE IF NOT EXISTS app_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- 每日美股荐股：当前观察/下手持仓。
  CREATE TABLE IF NOT EXISTS recommend_book (
    symbol               TEXT PRIMARY KEY,
    name                 TEXT,
    bucket               TEXT NOT NULL,
    thesis               TEXT NOT NULL DEFAULT '',
    expected_return_pct  REAL NOT NULL,
    stop_pct             REAL NOT NULL,
    entry_price          REAL NOT NULL,
    horizon_days         INTEGER NOT NULL,
    conviction           INTEGER NOT NULL,
    opened_at            INTEGER NOT NULL,
    last_run_id          TEXT,
    feature_ms           INTEGER,
    feature_engine_version TEXT,
    feature_summary      TEXT,
    source_note          TEXT
  );

  -- 下手/观察被轮换出局后的成绩单。
  CREATE TABLE IF NOT EXISTS recommend_history (
    id                   TEXT PRIMARY KEY,
    symbol               TEXT NOT NULL,
    name                 TEXT,
    bucket               TEXT NOT NULL,
    opened_at            INTEGER NOT NULL,
    closed_at            INTEGER NOT NULL,
    entry_price          REAL NOT NULL,
    exit_price           REAL NOT NULL,
    expected_return_pct  REAL NOT NULL,
    actual_return_pct    REAL NOT NULL,
    thesis               TEXT NOT NULL DEFAULT '',
    close_reason         TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_recommend_history_closed ON recommend_history(closed_at DESC);

  CREATE TABLE IF NOT EXISTS recommend_runs (
    id          TEXT PRIMARY KEY,
    ran_at      INTEGER NOT NULL,
    status      TEXT NOT NULL,
    summary     TEXT NOT NULL DEFAULT '',
    email_sent  INTEGER NOT NULL DEFAULT 0,
    payload     TEXT NOT NULL DEFAULT '{}'
  );

  -- 确定性回测运行。完整结果以版本化 JSON 保存，常用摘要字段单独成列，
  -- 既保留可复现的输入与逐点曲线，也避免历史列表每次解析大块 JSON。
  CREATE TABLE IF NOT EXISTS backtest_runs (
    id                    TEXT PRIMARY KEY,
    created_at            INTEGER NOT NULL,
    symbol                TEXT NOT NULL,
    period                TEXT NOT NULL,
    adjust                TEXT NOT NULL,
    strategy              TEXT NOT NULL,
    strategy_name         TEXT NOT NULL,
    engine_version        TEXT NOT NULL,
    start_time            INTEGER NOT NULL,
    end_time              INTEGER NOT NULL,
    total_return_pct      REAL NOT NULL,
    benchmark_return_pct  REAL NOT NULL,
    max_drawdown_pct      REAL NOT NULL,
    trade_count           INTEGER NOT NULL,
    request               TEXT NOT NULL,
    result                TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_backtest_runs_created ON backtest_runs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_backtest_runs_symbol ON backtest_runs(symbol, created_at DESC);

  -- AI Wyckoff 计划回测是长任务：运行状态与每次匿名模型调用分开保存。
  -- symbol/真实时间只用于服务端取行情与图表回放，绝不会写入 anonymous_input。
  CREATE TABLE IF NOT EXISTS ai_backtest_runs (
    id               TEXT PRIMARY KEY,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    status           TEXT NOT NULL,
    symbol           TEXT NOT NULL,
    period           TEXT NOT NULL,
    adjust           TEXT NOT NULL,
    start_time       INTEGER,
    end_time         INTEGER,
    progress_current INTEGER NOT NULL DEFAULT 0,
    progress_total   INTEGER NOT NULL DEFAULT 0,
    model            TEXT NOT NULL,
    prompt_version   TEXT NOT NULL,
    engine_version   TEXT,
    request          TEXT NOT NULL,
    result           TEXT,
    error            TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ai_backtest_runs_created ON ai_backtest_runs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ai_backtest_runs_symbol ON ai_backtest_runs(symbol, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ai_backtest_runs_status ON ai_backtest_runs(status);

  CREATE TABLE IF NOT EXISTS ai_backtest_calls (
    id                  TEXT PRIMARY KEY,
    run_id              TEXT NOT NULL REFERENCES ai_backtest_runs(id) ON DELETE CASCADE,
    created_at          INTEGER NOT NULL,
    as_of_index         INTEGER NOT NULL,
    as_of_time          INTEGER NOT NULL,
    candidate_key       TEXT NOT NULL,
    status              TEXT NOT NULL,
    input_hash          TEXT NOT NULL,
    anonymous_input     TEXT NOT NULL,
    raw_output          TEXT,
    parsed_output       TEXT,
    error               TEXT,
    model               TEXT NOT NULL,
    prompt_version      TEXT NOT NULL,
    response_id         TEXT,
    input_tokens        INTEGER,
    output_tokens       INTEGER,
    total_tokens        INTEGER,
    duration_ms         INTEGER NOT NULL,
    cache_hit           INTEGER NOT NULL DEFAULT 0,
    cached_from_call_id TEXT REFERENCES ai_backtest_calls(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ai_backtest_calls_run ON ai_backtest_calls(run_id, as_of_index, created_at);
  CREATE INDEX IF NOT EXISTS idx_ai_backtest_calls_cache
    ON ai_backtest_calls(input_hash, model, prompt_version, status, created_at DESC);
`);

try {
  db.exec("ALTER TABLE recommend_book ADD COLUMN feature_ms INTEGER");
} catch {
  /* 列已存在 */
}

for (const statement of [
  "ALTER TABLE recommend_book ADD COLUMN feature_engine_version TEXT",
  "ALTER TABLE recommend_book ADD COLUMN feature_summary TEXT",
  "ALTER TABLE recommend_book ADD COLUMN source_note TEXT",
]) {
  try {
    db.exec(statement);
  } catch {
    /* 列已存在 */
  }
}

try {
  db.exec("ALTER TABLE watch_groups ADD COLUMN managed_key TEXT");
} catch {
  /* 列已存在 */
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_groups_managed_key ON watch_groups(managed_key) WHERE managed_key IS NOT NULL");

try {
  db.exec("ALTER TABLE backtest_runs ADD COLUMN engine_version TEXT NOT NULL DEFAULT 'unknown'");
} catch {
  /* 列已存在 */
}

// 默认收藏分组，保证前端永远有一个可落脚的分组。
const groupCount = db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM watch_groups").get();
if (!groupCount || groupCount.n === 0) {
  db.prepare("INSERT INTO watch_groups (name, sort) VALUES (?, 0)").run("自选");
}

export function getState(key: string): string | undefined {
  const row = db.prepare<[string], { value: string }>("SELECT value FROM app_state WHERE key = ?").get(key);
  return row?.value;
}

export function setState(key: string, value: string): void {
  db.prepare("INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    value,
  );
}
