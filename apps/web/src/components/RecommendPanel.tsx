import { History, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { RecommendBucket, RecommendRunSummary } from "@wyckoff/shared";
import { useWorkbench } from "@/store.js";
import { cn, classifyChange, formatDate, formatDateTime, formatDuration, formatPercent, formatPrice } from "@/lib/utils.js";

type Tab = "book" | "history" | "runs";

const TABS: { id: Tab; label: string }[] = [
  { id: "book", label: "当前名单" },
  { id: "history", label: "轮换记录" },
  { id: "runs", label: "运行记录" },
];

/**
 * 美股日报记录页：观察/下手持仓、出局成绩单、历次运行摘要。
 * 数据来自 GET /api/recommend，打开时自动刷新一次现价。
 */
export function RecommendPanel() {
  const open = useWorkbench((s) => s.recommendOpen);
  const setRecommendOpen = useWorkbench((s) => s.setRecommendOpen);
  const setSymbol = useWorkbench((s) => s.setSymbol);
  const book = useWorkbench((s) => s.recommendBook);
  const history = useWorkbench((s) => s.recommendHistory);
  const runs = useWorkbench((s) => s.recommendRuns);
  const lastRun = useWorkbench((s) => s.recommendRun);
  const running = useWorkbench((s) => s.recommendRunning);
  const runRecommend = useWorkbench((s) => s.runRecommend);
  const refreshRecommend = useWorkbench((s) => s.refreshRecommend);

  const [tab, setTab] = useState<Tab>("book");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRecommendOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setRecommendOpen]);

  const watchCount = useMemo(() => book.filter((b) => b.bucket === "watch").length, [book]);
  const enterCount = book.length - watchCount;

  if (!open) return null;

  const toggleExpand = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const jumpToChart = (symbol: string, name: string | null) => {
    void setSymbol(symbol, name);
    setRecommendOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-[3vh] backdrop-blur-sm"
      onClick={() => setRecommendOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="美股推荐记录"
        className="glass-panel-strong modal-glass flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-[22px] animate-rise"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ——— 头部 ——— */}
        <div className="flex items-center gap-3 border-b border-line-soft px-4 py-3">
          <History size={15} className="shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] font-semibold text-ink">美股日报 · 记录</span>
              <span className="text-[11px] text-ink-faint">
                观察 {watchCount} / 下手 {enterCount} / 合计 {book.length}
              </span>
            </div>
            <div className="truncate text-[10px] text-ink-faint">
              {lastRun
                ? `上次运行 ${formatDateTime(lastRun.ranAt, true)} · ${lastRun.summary}`
                : "还没有运行过扫描"}
            </div>
          </div>
          <button
            type="button"
            disabled={running}
            onClick={() => void runRecommend()}
            className="glass-btn-primary flex shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[11px]"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {running ? "扫描中…" : "立即扫描"}
          </button>
          <button
            type="button"
            title="刷新"
            onClick={() => void refreshRecommend()}
            className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-panel-2 hover:text-ink"
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            title="关闭"
            onClick={() => setRecommendOpen(false)}
            className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-panel-2 hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        {/* ——— 页签 ——— */}
        <div className="flex items-center gap-1 border-b border-line-soft px-3 py-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "glass-chip rounded-[8px] px-2.5 py-1 text-[11px]",
                tab === t.id && "glass-chip-active",
              )}
            >
              {t.label}
              <span className="ml-1.5 font-mono text-[10px] opacity-70">
                {t.id === "book" ? book.length : t.id === "history" ? history.length : runs.length}
              </span>
            </button>
          ))}
        </div>

        {/* ——— 内容 ——— */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === "book" && <BookTab book={book} expanded={expanded} onToggle={toggleExpand} onJump={jumpToChart} />}
          {tab === "history" && (
            <HistoryTab history={history} expanded={expanded} onToggle={toggleExpand} onJump={jumpToChart} />
          )}
          {tab === "runs" && <RunsTab runs={runs} />}
        </div>
      </div>
    </div>
  );
}

// ————————————————— 当前推荐名单 —————————————————

function BookTab({
  book,
  expanded,
  onToggle,
  onJump,
}: {
  book: ReturnType<typeof useWorkbench.getState>["recommendBook"];
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onJump: (symbol: string, name: string | null) => void;
}) {
  const stats = useMemo(() => {
    const priced = book.filter((b) => b.actualReturnPct !== null);
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    return {
      avgExpected: avg(book.map((b) => b.expectedReturnPct)),
      avgActual: avg(priced.map((b) => b.actualReturnPct!)),
      priced: priced.length,
    };
  }, [book]);

  return (
    <div className="min-w-[980px]">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <StatChip label="平均期望" value={stats.avgExpected === null ? "-" : formatPercent(stats.avgExpected)} />
        <StatChip
          label="当前实际"
          value={stats.avgActual === null ? "-" : formatPercent(stats.avgActual)}
          tone={stats.avgActual !== null ? classifyChange(stats.avgActual) : undefined}
        />
        <StatChip label="已更新现价" value={String(stats.priced)} tone="text-ink-dim" />
        <span className="text-[10px] text-ink-faint">点击代码可在图表中打开；点击逻辑可展开全文</span>
      </div>
      <table className="mt-2 w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-[#0a111e]/95 backdrop-blur-xl">
          <tr className="text-left text-[10px] text-ink-faint">
            <th className="px-3 py-2 font-medium">分组</th>
            <th className="px-3 py-2 font-medium">代码 / 名称</th>
            <th className="px-3 py-2 font-medium">入选/切换价</th>
            <th className="px-3 py-2 font-medium">现价</th>
            <th className="px-3 py-2 font-medium">实际收益</th>
            <th className="px-3 py-2 font-medium">期望</th>
            <th className="px-3 py-2 font-medium">止损</th>
            <th className="px-3 py-2 font-medium">跟踪周期</th>
            <th className="px-3 py-2 font-medium">确信</th>
            <th className="px-3 py-2 font-medium">逻辑</th>
          </tr>
        </thead>
        <tbody>
          {book.length === 0 && (
            <tr>
              <td colSpan={10} className="px-4 py-12 text-center text-xs text-ink-faint">
                还没有推荐。运行一次「立即扫描」，或等待交易日 16:30 ET 的定时任务。
              </td>
            </tr>
          )}
          {book.map((item) => (
            <tr key={item.symbol} className="border-b border-line-soft transition-colors last:border-0 hover:bg-panel-2/50">
              <td className="px-3 py-2">
                <BucketChip bucket={item.bucket} />
              </td>
              <td className="px-3 py-2">
                <button type="button" className="text-left" onClick={() => onJump(item.symbol, item.name)} title="在图表中打开">
                  <div className="font-mono text-[12px] text-ink">{item.symbol.split(".")[0]}</div>
                  <div className="max-w-[110px] truncate text-[10px] text-ink-faint">{item.name ?? "—"}</div>
                </button>
              </td>
              <td className="px-3 py-2 font-mono text-[12px] text-ink-dim tabular-nums">{formatPrice(item.entryPrice)}</td>
              <td className="px-3 py-2 font-mono text-[12px] text-ink-dim tabular-nums">{formatPrice(item.lastPrice)}</td>
              <td
                className={cn(
                  "px-3 py-2 font-mono text-[12px] tabular-nums",
                  item.actualReturnPct === null ? "text-ink-faint" : classifyChange(item.actualReturnPct),
                )}
              >
                {item.actualReturnPct === null ? "-" : formatPercent(item.actualReturnPct)}
              </td>
              <td className="px-3 py-2 font-mono text-[12px] text-ink-dim tabular-nums">{formatPercent(item.expectedReturnPct)}</td>
              <td className="px-3 py-2 font-mono text-[12px] text-ink-faint tabular-nums">-{item.stopPct}%</td>
              <td className="px-3 py-2 font-mono text-[11px] text-ink-faint tabular-nums">
                {item.horizonDays} 天
                <div className="text-[10px] opacity-80">{formatDate(item.openedAt)} 开始</div>
              </td>
              <td className="px-3 py-2">
                <Conviction value={item.conviction} />
              </td>
              <td className="max-w-[320px] px-3 py-2">
                <button
                  type="button"
                  className="text-left"
                  onClick={() => onToggle(`book-${item.symbol}`)}
                  title={expanded.has(`book-${item.symbol}`) ? "收起" : "展开全文"}
                >
                  <p
                    className={cn(
                      "select-text text-[11px] leading-relaxed text-ink-dim",
                      !expanded.has(`book-${item.symbol}`) && "line-clamp-2",
                    )}
                  >
                    {item.thesis || "—"}
                  </p>
                  {item.featureEngineVersion && (
                    <span className="mt-1 block font-mono text-[9px] text-ink-faint">
                      特征引擎 v{item.featureEngineVersion}
                    </span>
                  )}
                  {expanded.has(`book-${item.symbol}`) && item.sourceNote && (
                    <p className="mt-2 text-[10px] leading-relaxed text-ink-faint">候选来源：{item.sourceNote}</p>
                  )}
                  {expanded.has(`book-${item.symbol}`) && item.featureSummary && (
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-[8px] bg-black/25 p-2 font-mono text-[9px] leading-relaxed text-ink-faint">
                      {item.featureSummary}
                    </pre>
                  )}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ————————————————— 出局记录 —————————————————

function HistoryTab({
  history,
  expanded,
  onToggle,
  onJump,
}: {
  history: ReturnType<typeof useWorkbench.getState>["recommendHistory"];
  expanded: Set<string>;
  onToggle: (key: string) => void;
  onJump: (symbol: string, name: string | null) => void;
}) {
  const stats = useMemo(() => {
    const wins = history.filter((h) => h.actualReturnPct > 0).length;
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    return {
      total: history.length,
      winRate: history.length ? Math.round((wins / history.length) * 100) : null,
      avgExpected: avg(history.map((h) => h.expectedReturnPct)),
      avgActual: avg(history.map((h) => h.actualReturnPct)),
    };
  }, [history]);

  return (
    <div className="min-w-[900px]">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        <StatChip label="记录总数" value={String(stats.total)} />
        <StatChip
          label="正收益占比"
          value={stats.winRate === null ? "-" : `${stats.winRate}%`}
          tone={stats.winRate !== null && stats.winRate >= 50 ? "text-down" : stats.winRate === null ? undefined : "text-up"}
        />
        <StatChip label="平均期望" value={stats.avgExpected === null ? "-" : formatPercent(stats.avgExpected)} />
        <StatChip
          label="平均实际"
          value={stats.avgActual === null ? "-" : formatPercent(stats.avgActual)}
          tone={stats.avgActual !== null ? classifyChange(stats.avgActual) : undefined}
        />
        <span className="text-[10px] text-ink-faint">点击出局原因可展开完整判读</span>
      </div>
      <table className="mt-2 w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-[#0a111e]/95 backdrop-blur-xl">
          <tr className="text-left text-[10px] text-ink-faint">
            <th className="px-3 py-2 font-medium">代码 / 名称</th>
            <th className="px-3 py-2 font-medium">分组</th>
            <th className="px-3 py-2 font-medium">跟踪</th>
            <th className="px-3 py-2 font-medium">期望</th>
            <th className="px-3 py-2 font-medium">实际</th>
            <th className="px-3 py-2 font-medium">出局原因</th>
          </tr>
        </thead>
        <tbody>
          {history.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-12 text-center text-xs text-ink-faint">
                还没有轮换记录。推荐因止损、逾期、结构失效或容量调整退出后会记在这里。
              </td>
            </tr>
          )}
          {history.map((item) => (
            <tr key={item.id} className="border-b border-line-soft transition-colors last:border-0 hover:bg-panel-2/50">
              <td className="px-3 py-2">
                <button type="button" className="text-left" onClick={() => onJump(item.symbol, item.name)} title="在图表中打开">
                  <div className="font-mono text-[12px] text-ink">{item.symbol.split(".")[0]}</div>
                  <div className="max-w-[110px] truncate text-[10px] text-ink-faint">{item.name ?? "—"}</div>
                </button>
              </td>
              <td className="px-3 py-2">
                <BucketChip bucket={item.bucket} />
              </td>
              <td className="px-3 py-2 font-mono text-[11px] text-ink-faint tabular-nums">
                {Math.max(1, Math.round((item.closedAt - item.openedAt) / 86_400_000))} 天
                <div className="text-[10px] opacity-80">
                  {formatDate(item.openedAt)} → {formatDate(item.closedAt)}
                </div>
              </td>
              <td className="px-3 py-2 font-mono text-[12px] text-ink-dim tabular-nums">{formatPercent(item.expectedReturnPct)}</td>
              <td className={cn("px-3 py-2 font-mono text-[12px] tabular-nums", classifyChange(item.actualReturnPct))}>
                {formatPercent(item.actualReturnPct)}
              </td>
              <td className="max-w-[380px] px-3 py-2">
                <button
                  type="button"
                  className="text-left"
                  onClick={() => onToggle(item.id)}
                  title={expanded.has(item.id) ? "收起" : "展开全文"}
                >
                  <p className={cn("select-text text-[11px] leading-relaxed text-ink-dim", !expanded.has(item.id) && "line-clamp-2")}>
                    {item.closeReason}
                  </p>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ————————————————— 运行记录 —————————————————

function RunsTab({ runs }: { runs: RecommendRunSummary[] }) {
  return (
    <div className="min-w-[860px]">
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-[#0a111e]/95 backdrop-blur-xl">
          <tr className="text-left text-[10px] text-ink-faint">
            <th className="px-3 py-2 font-medium">时间</th>
            <th className="px-3 py-2 font-medium">状态</th>
            <th className="px-3 py-2 font-medium">摘要</th>
            <th className="px-3 py-2 font-medium">+下手</th>
            <th className="px-3 py-2 font-medium">+观察</th>
            <th className="px-3 py-2 font-medium">出局</th>
            <th className="px-3 py-2 font-medium">邮件</th>
            <th className="px-3 py-2 font-medium">耗时</th>
          </tr>
        </thead>
        <tbody>
          {runs.length === 0 && (
            <tr>
              <td colSpan={8} className="px-4 py-12 text-center text-xs text-ink-faint">还没有运行记录</td>
            </tr>
          )}
          {runs.map((run) => (
            <tr key={run.id} className="border-b border-line-soft transition-colors last:border-0 hover:bg-panel-2/50">
              <td className="px-3 py-2 font-mono text-[11px] text-ink-dim tabular-nums">{formatDateTime(run.ranAt, true)}</td>
              <td className="px-3 py-2">
                <StatusChip status={run.status} />
              </td>
              <td className="max-w-[320px] px-3 py-2 text-[11px] leading-relaxed text-ink-dim">{run.summary || "—"}</td>
              <td className="px-3 py-2 font-mono text-[12px] text-accent tabular-nums">{run.addedEnter.length}</td>
              <td className="px-3 py-2 font-mono text-[12px] text-ink-dim tabular-nums">{run.addedWatch.length}</td>
              <td className="px-3 py-2 font-mono text-[12px] text-warn tabular-nums">{run.dropped.length}</td>
              <td className="px-3 py-2 text-[11px] text-ink-faint">{run.emailSent ? "已发" : "—"}</td>
              <td className="px-3 py-2 font-mono text-[11px] text-ink-faint tabular-nums">{formatDuration(run.durationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ————————————————— 小组件 —————————————————

function BucketChip({ bucket }: { bucket: RecommendBucket }) {
  return bucket === "enter" ? (
    <span className="inline-flex items-center rounded-[6px] bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
      下手
    </span>
  ) : (
    <span className="inline-flex items-center rounded-[6px] bg-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-warn">
      观察
    </span>
  );
}

function Conviction({ value }: { value: number }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-[34px] items-center justify-center rounded-[6px] border px-1.5 py-0.5 font-mono text-[11px] tabular-nums",
        value >= 8 ? "border-accent/40 bg-accent-soft text-accent" : value >= 6 ? "border-line text-ink-dim" : "border-line-soft text-ink-faint",
      )}
    >
      {value}/10
    </span>
  );
}

function StatusChip({ status }: { status: RecommendRunSummary["status"] }) {
  if (status === "ok") {
    return (
      <span className="inline-flex items-center rounded-[6px] bg-down/12 px-1.5 py-0.5 text-[10px] font-medium text-down">
        成功
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center rounded-[6px] bg-up/12 px-1.5 py-0.5 text-[10px] font-medium text-up">
        失败
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-[6px] bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-faint">
      运行中
    </span>
  );
}

function StatChip({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline gap-1.5 rounded-[8px] border border-line bg-panel-2/60 px-2.5 py-1.5">
      <span className="text-[10px] text-ink-faint">{label}</span>
      <span className={cn("font-mono text-[12px] font-medium tabular-nums", tone ?? "text-ink")}>{value}</span>
    </div>
  );
}
