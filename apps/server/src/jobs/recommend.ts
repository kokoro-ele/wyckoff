import {
  makeId,
  type RecommendBookItem,
  type RecommendBucket,
  type RecommendHistoryItem,
  type RecommendRunSummary,
} from "@wyckoff/shared";
import { renderFeatureSummary } from "@wyckoff/wyckoff";
import { z } from "zod";
import { config, isLlmConfigured } from "../config.js";
import { completeJson, extractJson } from "../llm/complete.js";
import { resolveUsStock } from "../services/instruments.js";
import { sendMail } from "../services/mail.js";
import { getFeatures, getKlines } from "../services/market.js";
import * as store from "../services/recommendStore.js";
import * as watchlist from "../services/watchlist.js";
import { chooseCapacityRemovals, rotationExitPrice, selectEligibleCandidates } from "./recommendPolicy.js";

export const WATCH_GROUP = "观察（系统）";
export const ENTER_GROUP = "下手（系统）";

const candidateSchema = z.object({
  candidates: z.array(
    z.object({
      ticker: z.string(),
      sentiment: z.string().optional(),
      reason: z.string().optional(),
    source_url: z.string().optional(),
    }),
  ),
});

const decisionSchema = z.object({
  decision: z.enum(["enter", "watch", "skip", "drop", "keep"]),
  conviction: z.number().min(1).max(10),
  expected_return_pct: z.number().min(0).max(200),
  stop_pct: z.number().positive().max(100),
  horizon_days: z.number().int().min(1).max(365),
  thesis: z.string(),
});

type Decision = z.infer<typeof decisionSchema>;

interface SentimentHit {
  symbol: string;
  name: string | null;
  reason: string;
  sentiment: string;
  sourceUrl: string;
}

interface Mutation {
  addedWatch: string[];
  addedEnter: string[];
  dropped: string[];
  upgraded: string[];
  downgraded: string[];
}

interface Timing {
  featureMs: number;
  featureCount: number;
  llmMs: number;
}

function emptyTiming(): Timing {
  return { featureMs: 0, featureCount: 0, llmMs: 0 };
}

let running = false;

export function isRecommendRunning(): boolean {
  return running;
}

export async function runDailyRecommend(trigger: "cron" | "manual" = "cron"): Promise<RecommendRunSummary> {
  if (running) throw new Error("荐股任务正在运行");
  if (!isLlmConfigured) throw new Error("未配置 OPENAI_API_KEY，无法跑荐股任务");

  running = true;
  const runId = makeId("rec");
  const startedAt = Date.now();
  const timing = emptyTiming();
  const mutations: Mutation = { addedWatch: [], addedEnter: [], dropped: [], upgraded: [], downgraded: [] };

  const finish = (status: RecommendRunSummary["status"], summary: string, emailSent: boolean): RecommendRunSummary => ({
    id: runId,
    ranAt: Date.now(),
    status,
    summary,
    emailSent,
    addedWatch: mutations.addedWatch,
    addedEnter: mutations.addedEnter,
    dropped: mutations.dropped,
    upgraded: mutations.upgraded,
    downgraded: mutations.downgraded,
    durationMs: Date.now() - startedAt,
    featureMs: timing.featureMs,
    featureCount: timing.featureCount,
    llmMs: timing.llmMs,
  });

  try {
    console.log(`[recommend] 开始 ${trigger} 扫描（美股，候选 ${config.recommend.candidateCount}，容量 ${config.recommend.bookCap}）`);
    const watchGroup = watchlist.ensureManagedGroup("recommend_watch", WATCH_GROUP);
    const enterGroup = watchlist.ensureManagedGroup("recommend_enter", ENTER_GROUP);

    const initialBook = store.listBook();
    const workingBook = new Map(initialBook.map((item) => [item.symbol, item]));
    const stagedHistory: RecommendHistoryItem[] = [];
    const blockedThisRun = new Set(initialBook.map((item) => item.symbol));
    await reviewExisting(initialBook, workingBook, stagedHistory, mutations, timing, runId);

    const hits = await collectSentiment(config.recommend.candidateCount, timing);
    const newHits = selectEligibleCandidates(hits, blockedThisRun, new Set(workingBook.keys()));
    await mapWithConcurrency(newHits, config.recommend.concurrency, (hit) =>
      considerNew(hit, workingBook, mutations, timing, runId),
    );

    enforceCapacity(workingBook, blockedThisRun, stagedHistory, mutations);

    const nextBook = sortBook([...workingBook.values()]);
    const summary = buildSummary(nextBook, mutations, timing, Date.now() - startedAt);
    const run = finish("ok", summary, false);
    store.commitSuccessfulRun({
      book: nextBook,
      history: stagedHistory,
      run,
      watchGroupId: watchGroup.id,
      enterGroupId: enterGroup.id,
    });

    try {
      run.emailSent = await sendMail(
        `Wyckoff 美股日报 · 下手 ${nextBook.filter((i) => i.bucket === "enter").length} / 观察 ${nextBook.filter((i) => i.bucket === "watch").length}`,
        renderEmail(nextBook, mutations, summary, timing, Date.now() - startedAt),
      );
      if (run.emailSent) store.markRunEmailSent(run.id);
    } catch (error) {
      console.warn("[recommend] 邮件发送失败：", (error as Error).message);
    }

    console.log(`[recommend] 完成：${summary}`);
    return run;
  } catch (error) {
    const run = finish("error", (error as Error).message || "荐股任务失败", false);
    store.insertRun(run);
    throw error;
  } finally {
    running = false;
  }
}

async function reviewExisting(
  book: RecommendBookItem[],
  workingBook: Map<string, RecommendBookItem>,
  stagedHistory: RecommendHistoryItem[],
  mutations: Mutation,
  timing: Timing,
  runId: string,
): Promise<void> {
  await mapWithConcurrency(book, config.recommend.concurrency, async (pos) => {
    try {
      const snapshot = await loadSnapshot(pos.symbol, timing);
      if (!snapshot) {
        console.warn(`[recommend] 复核 ${pos.symbol} 无行情，保留原状态`);
        return;
      }

      const pnl = returnPct(pos.entryPrice, snapshot.price);
      const ageDays = (Date.now() - pos.openedAt) / 86_400_000;

      if (pos.bucket === "enter" && pnl <= -Math.abs(pos.stopPct)) {
        closePosition(pos, snapshot.price, `止损（${pnl.toFixed(1)}%）`, workingBook, stagedHistory, mutations);
        return;
      }
      if (pos.bucket === "enter" && ageDays > pos.horizonDays * 1.5 && pnl < pos.expectedReturnPct * 0.25) {
        closePosition(pos, snapshot.price, `逾期未达预期（${ageDays.toFixed(0)} 天，${pnl.toFixed(1)}%）`, workingBook, stagedHistory, mutations);
        return;
      }

      const decision = await judgeSymbol({
        symbol: pos.symbol,
        name: pos.name,
        features: snapshot.features,
        existing: pos,
        news: "",
        timing,
      });

      if (decision.decision === "drop") {
        closePosition(pos, snapshot.price, `结构失效：${decision.thesis}`, workingBook, stagedHistory, mutations);
        return;
      }

      const nextBucket: RecommendBucket =
        decision.decision === "enter" ? "enter" : decision.decision === "watch" ? "watch" : pos.bucket;

      if (pos.bucket === "watch" && nextBucket === "enter") mutations.upgraded.push(pos.symbol);
      if (pos.bucket === "enter" && nextBucket === "watch") mutations.downgraded.push(pos.symbol);

      const bucketChanged = nextBucket !== pos.bucket;
      if (bucketChanged) {
        stageHistory(
          pos,
          snapshot.price,
          nextBucket === "enter" ? `升级至下手：${decision.thesis}` : `降级至观察：${decision.thesis}`,
          stagedHistory,
        );
      }
      workingBook.set(pos.symbol, {
        ...pos,
        name: snapshot.name ?? pos.name,
        bucket: nextBucket,
        thesis: decision.thesis,
        expectedReturnPct: decision.expected_return_pct,
        stopPct: Math.abs(decision.stop_pct) || pos.stopPct,
        entryPrice: bucketChanged ? snapshot.price : pos.entryPrice,
        openedAt: bucketChanged ? Date.now() : pos.openedAt,
        conviction: Math.round(decision.conviction),
        featureMs: snapshot.featureMs,
        lastPrice: snapshot.price,
        actualReturnPct: pnl,
        lastRunId: runId,
        featureEngineVersion: snapshot.engineVersion,
        featureSummary: snapshot.features,
      });
    } catch (error) {
      console.warn(`[recommend] 复核 ${pos.symbol} 失败：`, (error as Error).message);
    }
  });
}

async function considerNew(
  hit: SentimentHit,
  workingBook: Map<string, RecommendBookItem>,
  mutations: Mutation,
  timing: Timing,
  runId: string,
): Promise<void> {
  try {
    const snapshot = await loadSnapshot(hit.symbol, timing);
    if (!snapshot) return;

    const decision = await judgeSymbol({
      symbol: hit.symbol,
      name: snapshot.name,
      features: snapshot.features,
      existing: null,
      news: `${hit.sentiment} ${hit.reason}`.trim(),
      timing,
    });

    if (decision.decision === "skip" || decision.decision === "drop" || decision.decision === "keep") {
      console.log(`[recommend] 跳过 ${hit.symbol}：${decision.thesis}`);
      return;
    }

    const bucket: RecommendBucket = decision.decision === "enter" ? "enter" : "watch";
    workingBook.set(hit.symbol, {
      symbol: hit.symbol,
      name: snapshot.name,
      bucket,
      thesis: decision.thesis,
      expectedReturnPct: decision.expected_return_pct,
      stopPct: Math.abs(decision.stop_pct) || 8,
      entryPrice: snapshot.price,
      horizonDays: Math.max(5, Math.round(decision.horizon_days) || 20),
      conviction: Math.round(decision.conviction),
      openedAt: Date.now(),
      featureMs: snapshot.featureMs,
      lastPrice: snapshot.price,
      actualReturnPct: 0,
      lastRunId: runId,
      featureEngineVersion: snapshot.engineVersion,
      featureSummary: snapshot.features,
      sourceNote: [hit.sentiment, hit.reason, hit.sourceUrl].filter(Boolean).join(" · ") || null,
    });
    if (bucket === "enter") mutations.addedEnter.push(hit.symbol);
    else mutations.addedWatch.push(hit.symbol);
  } catch (error) {
    console.warn(`[recommend] 分析 ${hit.symbol} 失败：`, (error as Error).message);
  }
}

function enforceCapacity(
  workingBook: Map<string, RecommendBookItem>,
  initialSymbols: Set<string>,
  stagedHistory: RecommendHistoryItem[],
  mutations: Mutation,
): void {
  const cap = config.recommend.bookCap;
  const decision = chooseCapacityRemovals([...workingBook.values()], cap, initialSymbols);
  for (const victim of decision.rejectedNew) {
    workingBook.delete(victim.symbol);
    mutations.addedWatch = mutations.addedWatch.filter((symbol) => symbol !== victim.symbol);
    mutations.addedEnter = mutations.addedEnter.filter((symbol) => symbol !== victim.symbol);
  }
  for (const victim of decision.removedExisting) {
    closePosition(
      victim,
      rotationExitPrice(victim),
      `容量轮换（观察+下手超过 ${cap}）`,
      workingBook,
      stagedHistory,
      mutations,
    );
  }
}

function closePosition(
  pos: RecommendBookItem,
  exitPrice: number,
  reason: string,
  workingBook: Map<string, RecommendBookItem>,
  stagedHistory: RecommendHistoryItem[],
  mutations: Mutation,
): void {
  stageHistory(pos, exitPrice, reason, stagedHistory);
  workingBook.delete(pos.symbol);
  if (!mutations.dropped.includes(pos.symbol)) mutations.dropped.push(pos.symbol);
}

function stageHistory(
  pos: RecommendBookItem,
  exitPrice: number,
  reason: string,
  stagedHistory: RecommendHistoryItem[],
): void {
  stagedHistory.push({
    id: makeId("rh"),
    symbol: pos.symbol,
    name: pos.name,
    bucket: pos.bucket,
    openedAt: pos.openedAt,
    closedAt: Date.now(),
    entryPrice: pos.entryPrice,
    exitPrice,
    expectedReturnPct: pos.expectedReturnPct,
    actualReturnPct: returnPct(pos.entryPrice, exitPrice),
    thesis: pos.thesis,
    closeReason: reason,
  });
}

async function collectSentiment(limit: number, timing: Timing): Promise<SentimentHit[]> {
  const text = await timedLlm(timing, () =>
    completeJson({
      instructions:
        "You research US-listed common stocks only. Never return ETFs, indexes, ADRs of Chinese companies unless they are NYSE/Nasdaq tickers you are sure about, options, crypto, or OTC. Prefer liquid large/mid caps with a possible Wyckoff range. Reply with JSON only.",
      input: `Search today's US equity news, Reddit/StockTwits sentiment, unusual options activity, and notable movers.
Pick ${limit} individual US stocks (ticker only) attracting attention right now.
JSON shape: {"candidates":[{"ticker":"AAPL","sentiment":"bullish|bearish|mixed","reason":"one sentence","source_url":"https://primary-source.example/article"}]}`,
      webSearch: true,
      requireWebSearch: true,
    }),
  );

  const parsed = candidateSchema.safeParse(extractJson(text));
  if (!parsed.success) {
    console.warn("[recommend] 舆情 JSON 解析失败");
    return [];
  }

  const hits: SentimentHit[] = [];
  const seen = new Set<string>();
  for (const row of parsed.data.candidates) {
    const instrument = resolveUsStock(row.ticker);
    if (!instrument || seen.has(instrument.symbol)) continue;
    seen.add(instrument.symbol);
    hits.push({
      symbol: instrument.symbol,
      name: instrument.name,
      reason: row.reason ?? "",
      sentiment: row.sentiment ?? "",
      sourceUrl: row.source_url ?? "",
    });
    if (hits.length >= limit) break;
  }
  console.log(`[recommend] 舆情入围 ${hits.map((h) => h.symbol).join(", ") || "（空）"}`);
  return hits;
}

async function judgeSymbol(input: {
  symbol: string;
  name: string | null;
  features: string;
  existing: RecommendBookItem | null;
  news: string;
  timing: Timing;
}): Promise<Decision> {
  const existingNote = input.existing
    ? `已在推荐名单：状态 ${input.existing.bucket === "enter" ? "下手" : "观察"}，入选/切换参考价 ${input.existing.entryPrice}，期望 ${input.existing.expectedReturnPct}%，风险阈值 ${input.existing.stopPct}%，跟踪 ${Math.round((Date.now() - input.existing.openedAt) / 86_400_000)} 天。`
    : "新候选，尚未进入推荐名单。";

  const text = await timedLlm(input.timing, () =>
    completeJson({
      instructions: `你是专做美股的 Wyckoff 结构分析师。只输出 JSON。
decision 只能是：
- enter：结构清晰、风险收益可下手（对应收藏夹「下手」）
- watch：值得跟踪但还不到介入（「观察」）
- skip：新票直接放弃
- drop：已有推荐应移出名单
- keep：已有推荐维持原状态
expected_return_pct 是从当前价到目标的百分比（正数），stop_pct 是止损幅度（正数）。
thesis 用中文，两三句，点名事件或阶段。描述结构与风险，不要承诺收益。`,
      input: `标的 ${input.symbol} ${input.name ?? ""}
${existingNote}
舆情/新闻：${input.news || "无"}

${input.features}

JSON：{"decision":"enter|watch|skip|drop|keep","conviction":1-10,"expected_return_pct":8,"stop_pct":6,"horizon_days":20,"thesis":"..."}`,
      // 候选发现阶段已经联网；旧名单的日常结构复核无需再次逐股搜索。
      webSearch: input.existing === null && input.news.length > 0,
    }),
  );

  const parsed = decisionSchema.safeParse(extractJson(text));
  if (!parsed.success) {
    return {
      decision: input.existing ? "keep" : "skip",
      conviction: 3,
      expected_return_pct: input.existing?.expectedReturnPct ?? 0,
      stop_pct: input.existing?.stopPct ?? 8,
      horizon_days: input.existing?.horizonDays ?? 20,
      thesis: "模型输出无法解析，维持原状",
    };
  }
  if (input.existing && parsed.data.decision === "skip") {
    return { ...parsed.data, decision: "keep" };
  }
  return parsed.data;
}

async function loadSnapshot(
  symbol: string,
  timing: Timing,
): Promise<{ price: number; name: string | null; features: string; featureMs: number; engineVersion: string } | null> {
  const started = Date.now();
  const features = await getFeatures({ symbol, period: "1d", adjust: "forward", count: 400 });
  if (features.barCount === 0) return null;
  const featureMs = Date.now() - started;
  timing.featureMs += featureMs;
  timing.featureCount += 1;
  const instrument = resolveUsStock(symbol);
  return {
    price: features.price.last,
    name: instrument?.name ?? features.symbol,
    features: renderFeatureSummary(features),
    featureMs,
    engineVersion: features.engine.version,
  };
}

function sortBook(book: RecommendBookItem[]): RecommendBookItem[] {
  return book.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket.localeCompare(b.bucket);
    return b.conviction - a.conviction || a.openedAt - b.openedAt;
  });
}

async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function timedLlm<T>(timing: Timing, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    timing.llmMs += Date.now() - started;
  }
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

function formatTimingLine(timing: Timing, durationMs: number): string {
  const avg = timing.featureCount > 0 ? Math.round(timing.featureMs / timing.featureCount) : 0;
  return `特征快照 ${timing.featureCount} 次 ${formatDurationMs(timing.featureMs)}（均 ${formatDurationMs(avg)}）· LLM ${formatDurationMs(timing.llmMs)} · 整轮 ${formatDurationMs(durationMs)}`;
}

function returnPct(entry: number, last: number): number {
  if (!entry) return 0;
  return Math.round(((last - entry) / entry) * 1000) / 10;
}

function buildSummary(book: RecommendBookItem[], mutations: Mutation, _timing: Timing, _durationMs: number): string {
  const enter = book.filter((i) => i.bucket === "enter").length;
  const watch = book.filter((i) => i.bucket === "watch").length;
  return `观察 ${watch} / 下手 ${enter}（合计 ${book.length}/${config.recommend.bookCap}）。新增观察 ${mutations.addedWatch.length}、下手 ${mutations.addedEnter.length}，轮换出局 ${mutations.dropped.length}，升级 ${mutations.upgraded.length}，降级 ${mutations.downgraded.length}。`;
}

function renderEmail(
  book: RecommendBookItem[],
  mutations: Mutation,
  summary: string,
  timing: Timing,
  durationMs: number,
): string {
  const history = store.listHistory(12);
  const enter = book.filter((i) => i.bucket === "enter");
  const watch = book.filter((i) => i.bucket === "watch");
  const row = (item: RecommendBookItem) =>
    `<tr><td>${item.symbol}</td><td>${item.name ?? ""}</td><td>${item.entryPrice.toFixed(2)}</td><td>${item.expectedReturnPct.toFixed(1)}%</td><td>${item.stopPct.toFixed(1)}%</td><td>${item.conviction}</td><td>${item.featureMs != null ? formatDurationMs(item.featureMs) : "-"}</td><td>${escapeHtml(item.thesis)}</td></tr>`;

  const histRow = (item: (typeof history)[number]) =>
    `<tr><td>${item.symbol}</td><td>${item.bucket === "enter" ? "下手" : "观察"}</td><td>${item.expectedReturnPct.toFixed(1)}%</td><td>${item.actualReturnPct.toFixed(1)}%</td><td>${escapeHtml(item.closeReason)}</td></tr>`;

  return `<!doctype html>
<html><body style="font-family:sans-serif;background:#0b1018;color:#e8eef8;padding:24px">
  <h2>Wyckoff 美股日报</h2>
  <p>${escapeHtml(summary)}</p>
  <p style="color:#9aa8bf;font-size:13px">${escapeHtml(formatTimingLine(timing, durationMs))}</p>
  ${mutations.addedEnter.length ? `<p>新下手：${mutations.addedEnter.join(", ")}</p>` : ""}
  ${mutations.addedWatch.length ? `<p>新观察：${mutations.addedWatch.join(", ")}</p>` : ""}
  ${mutations.dropped.length ? `<p>轮换出局：${mutations.dropped.join(", ")}</p>` : ""}
  <h3>下手（${enter.length}）</h3>
  <table border="1" cellpadding="6" style="border-collapse:collapse;font-size:13px">
    <tr><th>代码</th><th>名称</th><th>入选价</th><th>期望盈利</th><th>止损</th><th>确信</th><th>特征耗时</th><th>逻辑</th></tr>
    ${enter.map(row).join("") || "<tr><td colspan=8>空</td></tr>"}
  </table>
  <h3>观察（${watch.length}）</h3>
  <table border="1" cellpadding="6" style="border-collapse:collapse;font-size:13px">
    <tr><th>代码</th><th>名称</th><th>入选价</th><th>期望盈利</th><th>止损</th><th>确信</th><th>特征耗时</th><th>逻辑</th></tr>
    ${watch.map(row).join("") || "<tr><td colspan=8>空</td></tr>"}
  </table>
  <h3>最近出局（期望 vs 实际）</h3>
  <table border="1" cellpadding="6" style="border-collapse:collapse;font-size:13px">
    <tr><th>代码</th><th>当时分组</th><th>期望</th><th>实际</th><th>原因</th></tr>
    ${history.map(histRow).join("") || "<tr><td colspan=5>暂无</td></tr>"}
  </table>
  <p style="color:#6b7a94;font-size:12px">结构候选，不是买卖指令。仅美股个股。</p>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}

export async function enrichBookPrices(book: RecommendBookItem[]): Promise<RecommendBookItem[]> {
  const out: RecommendBookItem[] = [];
  for (const item of book) {
    try {
      const klines = await getKlines({ symbol: item.symbol, period: "1d", adjust: "forward", count: 2 });
      const last = klines[klines.length - 1]?.close ?? null;
      out.push({
        ...item,
        lastPrice: last,
        actualReturnPct: last === null ? null : returnPct(item.entryPrice, last),
      });
    } catch {
      out.push(item);
    }
  }
  return out;
}
