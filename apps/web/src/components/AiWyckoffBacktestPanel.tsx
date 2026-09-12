import {
  ADJUST_LABELS,
  ADJUST_TYPES,
  aiWyckoffBacktestRequestSchema,
  type AdjustType,
  type AiWyckoffBacktestResult,
  type AiWyckoffBacktestRunSummary,
  type AiWyckoffCurvePoint,
  type AiWyckoffPlan,
  type AiWyckoffPlanKind,
  type AiWyckoffReplayBar,
} from "@wyckoff/shared";
import {
  Activity,
  BarChart3,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Clock3,
  Eye,
  History,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  fetchAiWyckoffBacktest,
  fetchAiWyckoffBacktests,
  runAiWyckoffBacktest,
} from "@/lib/api.js";
import { classifyChange, cn, formatDate, formatPercent } from "@/lib/utils.js";

interface AiWyckoffBacktestPanelProps {
  open: boolean;
  onClose: () => void;
  symbol: string;
  adjust: AdjustType;
}

type ResultTab = "overview" | "plans" | "replay" | "audit";

interface Draft {
  adjust: AdjustType;
  startDate: string;
  endDate: string;
  initialCapital: string;
  positionSizePct: string;
  commissionBps: string;
  slippageBps: string;
  maxHoldingBars: string;
  contextBars: string;
  rangeLookback: string;
  planValidBars: string;
  maxAiDecisions: string;
  minDecisionGapBars: string;
}

const TABS: Array<{ id: ResultTab; label: string; icon: typeof Activity }> = [
  { id: "overview", label: "概览", icon: BarChart3 },
  { id: "plans", label: "交易计划", icon: BookOpen },
  { id: "replay", label: "K 量回放", icon: ScanLine },
  { id: "audit", label: "方法与审计", icon: ShieldCheck },
];

const INPUT_CLASS =
  "glass-input h-9 w-full px-2.5 font-mono text-[11px] tabular-nums text-ink [color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-50";

const PLAN_LABELS: Record<AiWyckoffPlanKind, string> = {
  observe: "观察",
  spring_test_long: "Spring / Test",
  sos_lps_long: "SOS / LPS",
  reaccumulation_long: "再吸筹",
  ut_utad_exit: "UT / UTAD 退出",
  sow_lpsy_exit: "SOW / LPSY 退出",
};

const STATUS_LABELS: Record<AiWyckoffPlan["status"], string> = {
  observed: "仅观察",
  waiting_entry: "等待触发",
  waiting_exit: "等待退出",
  entered: "已入场",
  closed: "已完成",
  invalidated: "已失效",
  expired: "已过期",
  executed: "已执行",
  superseded: "被替代",
  skipped: "已跳过",
};

export function AiWyckoffBacktestPanel({ open, onClose, symbol, adjust }: AiWyckoffBacktestPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);
  const [draft, setDraft] = useState<Draft>(() => createDraft(adjust));
  const [runs, setRuns] = useState<AiWyckoffBacktestRunSummary[]>([]);
  const [result, setResult] = useState<AiWyckoffBacktestResult | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<AiWyckoffBacktestRunSummary | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [tab, setTab] = useState<ResultTab>("overview");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshHistory = useCallback(async () => {
    const requestId = ++requestRef.current;
    setHistoryLoading(true);
    try {
      const response = await fetchAiWyckoffBacktests(20);
      if (requestRef.current === requestId) setRuns(response.runs);
    } catch (cause) {
      if (requestRef.current === requestId) setError(errorMessage(cause, "读取 AI 回测记录失败"));
    } finally {
      if (requestRef.current === requestId) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setDraft((current) => ({ ...current, adjust }));
    void refreshHistory();
  }, [adjust, open, refreshHistory]);

  useEffect(() => {
    if (!open || !activeRunId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const response = await fetchAiWyckoffBacktest(activeRunId);
        if (cancelled) return;
        setActiveRun(response.run);
        if (response.run.status === "completed" && response.result) {
          setResult(response.result);
          setSelectedPlanId(response.result.plans.find((plan) => plan.action !== "observe")?.id ?? response.result.plans[0]?.id ?? null);
          setActiveRunId(null);
          setTab("overview");
          void refreshHistory();
          return;
        }
        if (response.run.status === "failed") {
          setError(response.run.error ?? "AI 回测运行失败");
          setActiveRunId(null);
          void refreshHistory();
          return;
        }
        timer = setTimeout(() => void poll(), 1_500);
      } catch (cause) {
        if (cancelled) return;
        setError(errorMessage(cause, "读取 AI 回测进度失败"));
        setActiveRunId(null);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeRunId, open, refreshHistory]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    requestAnimationFrame(() => panel?.querySelector<HTMLElement>("[data-autofocus]")?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose, open]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = aiWyckoffBacktestRequestSchema.safeParse(toRequest(symbol, draft));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "请检查回测参数");
      return;
    }
    setStarting(true);
    setError(null);
    setResult(null);
    setActiveRun(null);
    try {
      const response = await runAiWyckoffBacktest(parsed.data);
      setActiveRunId(response.runId);
      setActiveRun({
        id: response.runId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: response.status,
        asset: "ASSET_001",
        progressCurrent: 0,
        progressTotal: 0,
        model: "",
      });
    } catch (cause) {
      setError(errorMessage(cause, "启动 AI 回测失败"));
    } finally {
      setStarting(false);
    }
  };

  const loadRun = async (id: string) => {
    if (activeRunId) return;
    setDetailLoadingId(id);
    setError(null);
    try {
      const response = await fetchAiWyckoffBacktest(id);
      setActiveRun(response.run);
      if (response.run.status === "running" || response.run.status === "queued") {
        setResult(null);
        setActiveRunId(id);
      } else if (response.run.status === "failed") {
        setError(response.run.error ?? "这次回测运行失败");
      } else if (response.result) {
        setResult(response.result);
        setSelectedPlanId(response.result.plans.find((plan) => plan.action !== "observe")?.id ?? response.result.plans[0]?.id ?? null);
        setTab("overview");
      }
    } catch (cause) {
      setError(errorMessage(cause, "读取 AI 回测详情失败"));
    } finally {
      setDetailLoadingId(null);
    }
  };

  if (!open) return null;

  const running = starting || activeRunId !== null;
  const selectedPlan = result?.plans.find((plan) => plan.id === selectedPlanId) ?? result?.plans[0] ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#02050b]/82 p-2 backdrop-blur-md sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-backtest-title"
        aria-describedby="ai-backtest-description"
        className="glass-panel-strong modal-glass grid h-full max-h-[960px] w-full max-w-[1520px] grid-rows-[minmax(360px,46%)_minmax(0,1fr)] overflow-hidden rounded-[22px] animate-rise lg:grid-cols-[342px_minmax(0,1fr)] lg:grid-rows-1"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <aside className="flex min-h-0 flex-col border-b border-line-soft lg:border-b-0 lg:border-r">
          <div className="panel-header flex items-start justify-between gap-3 border-b border-line-soft px-4 py-3.5">
            <div className="min-w-0">
              <div className="eyebrow">WYCKOFF · AI REPLAY</div>
              <h2 id="ai-backtest-title" className="mt-0.5 text-[15px] font-semibold text-ink">
                匿名单标的计划回测
              </h2>
              <p id="ai-backtest-description" className="mt-0.5 text-[10px] text-ink-faint">
                模型只看到 ASSET_001 的 K 线与成交量
              </p>
            </div>
            <button
              type="button"
              data-autofocus
              title="关闭回测"
              aria-label="关闭回测"
              onClick={onClose}
              className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-panel-2 hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>

          <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
              <PrivacyCard />

              <FormSection title="回放范围" description="日线固定；真实标识和日期只用于服务端取数，不进入模型输入。">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="周期" htmlFor="ai-period">
                    <input id="ai-period" className={INPUT_CLASS} value="日线 · 1D" disabled readOnly />
                  </Field>
                  <Field label="复权" htmlFor="ai-adjust">
                    <select
                      id="ai-adjust"
                      className={INPUT_CLASS}
                      value={draft.adjust}
                      onChange={(event) => updateDraft(setDraft, "adjust", event.target.value as AdjustType)}
                    >
                      {ADJUST_TYPES.map((value) => <option key={value} value={value}>{ADJUST_LABELS[value]}</option>)}
                    </select>
                  </Field>
                  <Field label="开始日期" htmlFor="ai-start-date">
                    <input id="ai-start-date" type="date" className={INPUT_CLASS} value={draft.startDate} max={draft.endDate} onChange={(event) => updateDraft(setDraft, "startDate", event.target.value)} />
                  </Field>
                  <Field label="结束日期" htmlFor="ai-end-date">
                    <input id="ai-end-date" type="date" className={INPUT_CLASS} value={draft.endDate} min={draft.startDate} max={todayDate()} onChange={(event) => updateDraft(setDraft, "endDate", event.target.value)} />
                  </Field>
                </div>
              </FormSection>

              <FormSection title="Wyckoff 观察窗" description="逐日扫描；只在结构候选发生时生成一份独立计划。">
                <div className="grid grid-cols-2 gap-2">
                  <NumberField id="ai-context" label="匿名上下文" value={draft.contextBars} min={40} max={300} step={10} suffix="根" onChange={(value) => updateDraft(setDraft, "contextBars", value)} />
                  <NumberField id="ai-range" label="区间回看" value={draft.rangeLookback} min={10} max={250} step={5} suffix="根" onChange={(value) => updateDraft(setDraft, "rangeLookback", value)} />
                  <NumberField id="ai-valid" label="计划有效期" value={draft.planValidBars} min={1} max={60} step={1} suffix="根" onChange={(value) => updateDraft(setDraft, "planValidBars", value)} />
                  <NumberField id="ai-gap" label="决策冷却" value={draft.minDecisionGapBars} min={1} max={60} step={1} suffix="根" onChange={(value) => updateDraft(setDraft, "minDecisionGapBars", value)} />
                  <NumberField id="ai-decisions" label="AI 决策上限" value={draft.maxAiDecisions} min={1} max={40} step={1} suffix="次" onChange={(value) => updateDraft(setDraft, "maxAiDecisions", value)} />
                  <NumberField id="ai-holding" label="最长持有" value={draft.maxHoldingBars} min={1} max={2000} step={5} suffix="根" onChange={(value) => updateDraft(setDraft, "maxHoldingBars", value)} />
                </div>
              </FormSection>

              <FormSection title="资金与成交" description="AI 只生成结构化计划，仓位、成交和成本由确定性引擎处理。">
                <div className="grid grid-cols-2 gap-2">
                  <NumberField id="ai-capital" label="初始资金" value={draft.initialCapital} min={1000} max={1_000_000_000} step={1000} onChange={(value) => updateDraft(setDraft, "initialCapital", value)} />
                  <NumberField id="ai-position" label="单次仓位" value={draft.positionSizePct} min={1} max={100} step={1} suffix="%" onChange={(value) => updateDraft(setDraft, "positionSizePct", value)} />
                  <NumberField id="ai-commission" label="佣金" value={draft.commissionBps} min={0} max={100} step={1} suffix="bps" onChange={(value) => updateDraft(setDraft, "commissionBps", value)} />
                  <NumberField id="ai-slippage" label="滑点" value={draft.slippageBps} min={0} max={100} step={1} suffix="bps" onChange={(value) => updateDraft(setDraft, "slippageBps", value)} />
                </div>
              </FormSection>

              <FormSection title="最近运行" description="结果只有匿名 bar 序号；真实代码不会出现在计划与回放中。">
                <div className="space-y-1.5">
                  {historyLoading && runs.length === 0 ? (
                    <div className="flex items-center gap-2 py-3 text-[11px] text-ink-faint"><Loader2 size={12} className="animate-spin" /> 读取记录…</div>
                  ) : runs.length === 0 ? (
                    <p className="py-3 text-[11px] text-ink-faint">还没有 AI 计划回测</p>
                  ) : runs.map((run) => (
                    <HistoryButton key={run.id} run={run} active={activeRun?.id === run.id} loading={detailLoadingId === run.id} disabled={running} onClick={() => void loadRun(run.id)} />
                  ))}
                </div>
              </FormSection>
            </div>

            <div className="border-t border-line-soft bg-black/10 p-3">
              <button type="submit" disabled={running} className="glass-btn-primary flex h-10 w-full items-center justify-center gap-2 rounded-[11px] text-[12px]">
                {running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                {starting ? "正在创建任务…" : running ? "AI 正在逐时点判读…" : "运行 AI Wyckoff 回测"}
              </button>
              <p className="mt-2 text-center text-[9px] leading-relaxed text-ink-faint">研究性历史回放，不构成收益承诺。</p>
            </div>
          </form>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col">
          <ResultHeader result={result} run={activeRun} historyLoading={historyLoading} onRefresh={() => void refreshHistory()} />
          <div role="tablist" aria-label="AI 回测结果视图" className="flex items-center gap-1 overflow-x-auto border-b border-line-soft px-3 py-2">
            {TABS.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  id={`ai-backtest-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  aria-controls={`ai-backtest-panel-${item.id}`}
                  tabIndex={tab === item.id ? 0 : -1}
                  disabled={!result}
                  onClick={() => setTab(item.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index, setTab)}
                  className={cn("glass-chip inline-flex shrink-0 items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-35", tab === item.id && "glass-chip-active")}
                >
                  <Icon size={12} /> {item.label}
                  {item.id === "plans" && result ? <span className="font-mono text-[9px] opacity-65">{result.plans.length}</span> : null}
                </button>
              );
            })}
          </div>

          <div className="relative min-h-0 flex-1 overflow-y-auto">
            {error ? <ErrorBanner message={error} /> : null}
            {running ? <RunningState run={activeRun} /> : null}
            {!running && !result ? <EmptyState /> : null}
            {result && tab === "overview" ? <Overview result={result} /> : null}
            {result && tab === "plans" ? <PlansLedger result={result} selectedPlanId={selectedPlan?.id ?? null} onSelect={(plan) => { setSelectedPlanId(plan.id); setTab("replay"); }} /> : null}
            {result && tab === "replay" ? <Replay result={result} selectedPlan={selectedPlan} onSelectPlan={setSelectedPlanId} /> : null}
            {result && tab === "audit" ? <Audit result={result} model={activeRun?.model ?? ""} /> : null}
            <div className="sr-only" aria-live="polite">
              {running ? `AI 回测正在运行，进度 ${activeRun?.progressCurrent ?? 0} / ${activeRun?.progressTotal ?? 0}` : result ? `回测完成，共 ${result.plans.length} 份计划` : ""}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function PrivacyCard() {
  return (
    <section className="rounded-[14px] border border-accent/20 bg-accent-soft/45 p-3">
      <div className="flex items-center gap-2 text-[10px] font-medium text-accent"><Eye size={13} /> AI 可见边界</div>
      <p className="mt-1.5 text-[9px] leading-relaxed text-ink-dim">匿名 OHLCV · BAR 序号 · 纯 Wyckoff。无代码、名称、日期、新闻、财报、行业、指数、均线或其他指标。</p>
    </section>
  );
}

function ResultHeader({ result, run, historyLoading, onRefresh }: { result: AiWyckoffBacktestResult | null; run: AiWyckoffBacktestRunSummary | null; historyLoading: boolean; onRefresh: () => void }) {
  return (
    <div className="panel-header flex min-h-[66px] items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2"><CircleDot size={14} className="shrink-0 text-accent" /><h3 className="truncate text-[13px] font-semibold text-ink">{result ? `${result.asset} · Wyckoff 计划回放` : "AI 决策工作台"}</h3></div>
        <p className="mt-1 truncate font-mono text-[9px] text-ink-faint">
          {result ? `${barLabel(result.data.evaluationStartBarIndex)} → ${barLabel(result.data.evaluationEndBarIndex)} · ${result.data.barCount} 根 · 引擎 ${result.engineVersion}` : run ? `${statusText(run.status)} · ${run.progressCurrent} / ${run.progressTotal || "?"} 个决策时点` : "等待运行 · 每次模型调用只有一个历史截止时点"}
        </p>
      </div>
      <button type="button" disabled={historyLoading} title="刷新运行记录" aria-label="刷新运行记录" onClick={onRefresh} className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-40"><RefreshCw size={14} className={historyLoading ? "animate-spin" : undefined} /></button>
    </div>
  );
}

function RunningState({ run }: { run: AiWyckoffBacktestRunSummary | null }) {
  const total = run?.progressTotal ?? 0;
  const current = run?.progressCurrent ?? 0;
  const progress = total > 0 ? Math.min(100, (current / total) * 100) : 8;
  return (
    <div className="flex min-h-[430px] flex-col items-center justify-center px-6 text-center">
      <div className="relative grid h-16 w-16 place-items-center rounded-[20px] border border-accent/20 bg-accent-soft"><Loader2 size={25} className="animate-spin text-accent" /><span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-down shadow-[0_0_12px_rgba(40,217,169,.8)]" /></div>
      <h4 className="mt-4 text-[13px] font-medium text-ink">逐时点生成 Wyckoff 交易计划</h4>
      <p className="mt-2 max-w-md text-[10px] leading-relaxed text-ink-faint">每次调用都截断未来 K 线，并在独立上下文中完成；计划生成后才交给确定性撮合器。</p>
      <div className="mt-5 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${progress}%` }} /></div>
      <p className="mt-2 font-mono text-[9px] text-ink-faint">{current} / {total || "?"} · {run?.model || "等待模型信息"}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-[430px] flex-col items-center justify-center px-6 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-[20px] border border-accent/20 bg-accent-soft text-accent"><ScanLine size={25} /></div>
      <h4 className="mt-4 text-[13px] font-medium text-ink">让 AI 只读图，不认股票</h4>
      <p className="mt-2 max-w-md text-[10px] leading-relaxed text-ink-faint">系统会把当前标的映射为 ASSET_001，只提交归一化 K 线和相对成交量。每份计划都有入场、止损、目标、证据与失效条件。</p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return <div role="alert" className="mx-4 mt-4 flex items-start gap-2 rounded-[12px] border border-up/25 bg-up/5 px-3 py-2.5 text-[11px] text-up"><TriangleAlert size={14} className="mt-0.5 shrink-0" /><span className="leading-relaxed">{message}</span></div>;
}

const Overview = memo(function Overview({ result }: { result: AiWyckoffBacktestResult }) {
  const metrics = result.metrics;
  return (
    <div id="ai-backtest-panel-overview" role="tabpanel" aria-labelledby="ai-backtest-tab-overview" className="space-y-4 p-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-5">
        <MetricCard label="累计收益" value={formatPercent(metrics.totalReturnPct)} tone={classifyChange(metrics.totalReturnPct)} />
        <MetricCard label="买入持有" value={formatPercent(metrics.benchmarkReturnPct)} tone={classifyChange(metrics.benchmarkReturnPct)} />
        <MetricCard label="超额收益" value={formatPercent(metrics.excessReturnPct)} tone={classifyChange(metrics.excessReturnPct)} />
        <MetricCard label="最大回撤" value={`-${Math.abs(metrics.maxDrawdownPct).toFixed(2)}%`} tone="text-warn" />
        <MetricCard label="Profit Factor" value={metrics.profitFactor === null ? "—" : metrics.profitFactor.toFixed(2)} />
        <MetricCard label="交易 / 计划" value={`${metrics.tradeCount} / ${metrics.planCount}`} />
        <MetricCard label="胜率" value={`${metrics.winRatePct.toFixed(1)}%`} />
        <MetricCard label="平均 R" value={signedNumber(metrics.averageR)} tone={classifyChange(metrics.averageR)} />
        <MetricCard label="平均 MFE / MAE" value={`${metrics.averageMfeR.toFixed(2)} / ${metrics.averageMaeR.toFixed(2)}`} />
        <MetricCard label="市场暴露" value={`${metrics.exposurePct.toFixed(1)}%`} />
      </dl>

      <AnonymousEquityCurve curve={result.curve} />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-[14px] border border-line-soft bg-black/10 p-3.5">
          <div className="flex items-center gap-2 text-[11px] font-medium text-ink"><Activity size={13} className="text-accent" /> 计划类型表现</div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[10px]">
              <thead className="text-left text-ink-faint"><tr><th className="pb-2 font-medium">结构计划</th><th className="pb-2 font-medium">生成</th><th className="pb-2 font-medium">触发</th><th className="pb-2 font-medium">交易</th><th className="pb-2 font-medium">胜率</th><th className="pb-2 font-medium">平均 R</th></tr></thead>
              <tbody>
                {Object.entries(metrics.byPlanKind).map(([kind, row]) => row ? (
                  <tr key={kind} className="border-t border-line-soft text-ink-dim">
                    <td className="py-2 pr-3 text-ink">{PLAN_LABELS[kind as AiWyckoffPlanKind]}</td>
                    <td className="py-2 font-mono">{row.plans}</td><td className="py-2 font-mono">{row.triggered}</td><td className="py-2 font-mono">{row.trades}</td><td className="py-2 font-mono">{row.winRatePct.toFixed(1)}%</td><td className={cn("py-2 font-mono", classifyChange(row.averageR))}>{signedNumber(row.averageR)}</td>
                  </tr>
                ) : null)}
                {Object.keys(metrics.byPlanKind).length === 0 ? <tr><td colSpan={6} className="py-8 text-center text-ink-faint">没有可统计的计划</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-[14px] border border-line-soft bg-black/10 p-3.5">
          <div className="flex items-center gap-2 text-[11px] font-medium text-ink"><Clock3 size={13} className="text-accent" /> 生命周期</div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
            <Snapshot label="触发计划" value={`${metrics.triggeredPlanCount}`} />
            <Snapshot label="过期计划" value={`${metrics.expiredPlanCount}`} />
            <Snapshot label="失效计划" value={`${metrics.invalidatedPlanCount}`} />
            <Snapshot label="计划过期率" value={`${metrics.planExpirationRatePct.toFixed(1)}%`} />
            <Snapshot label="计划失效率" value={`${metrics.planInvalidationRatePct.toFixed(1)}%`} />
            <Snapshot label="总交易成本" value={formatMoney(metrics.totalFees)} />
          </dl>
        </section>
      </div>

      {result.warnings.length > 0 ? (
        <section className="rounded-[14px] border border-warn/20 bg-warn/5 p-3.5">
          <div className="flex items-center gap-2 text-[11px] font-medium text-warn"><TriangleAlert size={13} /> 运行提示</div>
          <ul className="mt-2.5 space-y-1.5 text-[10px] leading-relaxed text-ink-dim">{result.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul>
        </section>
      ) : null}
    </div>
  );
});

function AnonymousEquityCurve({ curve }: { curve: AiWyckoffCurvePoint[] }) {
  const geometry = useMemo(() => makeEquityGeometry(curve), [curve]);
  if (!geometry) return <section className="rounded-[14px] border border-line-soft bg-black/10 p-12 text-center text-[11px] text-ink-faint">没有可绘制的权益路径</section>;
  return (
    <section className="overflow-hidden rounded-[14px] border border-line-soft bg-black/10">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-3.5 py-3">
        <div><h4 className="text-[11px] font-medium text-ink">匿名权益路径</h4><p className="mt-0.5 text-[9px] text-ink-faint">横轴只使用 BAR 序号；蓝线为计划策略，虚线为单标的买入持有</p></div>
        <div className="flex items-center gap-3 font-mono text-[9px] text-ink-faint" aria-hidden="true"><Legend color="#73b6ff" label="策略" /><Legend color="#718096" label="持有" dashed /></div>
      </div>
      <svg viewBox="0 0 1000 286" className="block min-h-[250px] w-full" role="img" aria-label="匿名回测权益曲线">
        <defs><linearGradient id="ai-equity-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#73b6ff" stopOpacity=".22" /><stop offset="100%" stopColor="#73b6ff" stopOpacity="0" /></linearGradient></defs>
        {geometry.grid.map((line) => <g key={line.y}><line x1="58" x2="980" y1={line.y} y2={line.y} stroke="rgba(185,215,255,.07)" /><text x="50" y={line.y + 3} textAnchor="end" fill="#66758d" fontSize="9" fontFamily="monospace">{formatCompact(line.value)}</text></g>)}
        <path d={geometry.area} fill="url(#ai-equity-fill)" />
        <path d={geometry.benchmark} fill="none" stroke="#718096" strokeWidth="1.3" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
        <path d={geometry.equity} fill="none" stroke="#73b6ff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <text x="58" y="278" fill="#66758d" fontSize="9" fontFamily="monospace">{barLabel(curve[0].barIndex)}</text>
        <text x="980" y="278" textAnchor="end" fill="#66758d" fontSize="9" fontFamily="monospace">{barLabel(curve.at(-1)!.barIndex)}</text>
      </svg>
    </section>
  );
}

function PlansLedger({ result, selectedPlanId, onSelect }: { result: AiWyckoffBacktestResult; selectedPlanId: string | null; onSelect: (plan: AiWyckoffPlan) => void }) {
  return (
    <div id="ai-backtest-panel-plans" role="tabpanel" aria-labelledby="ai-backtest-tab-plans" className="space-y-2 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h4 className="text-[12px] font-medium text-ink">逐份交易计划</h4><p className="mt-1 text-[9px] text-ink-faint">每个判断只引用生成时已经存在的匿名 K 线；点击计划进入当时视角。</p></div><span className="font-mono text-[9px] text-ink-faint">{result.plans.length} PLANS</span></div>
      {result.plans.map((plan) => (
        <button key={plan.id} type="button" onClick={() => onSelect(plan)} aria-current={selectedPlanId === plan.id ? "true" : undefined} className={cn("group w-full rounded-[14px] border p-3.5 text-left transition-colors", selectedPlanId === plan.id ? "border-accent/30 bg-accent-soft/55" : "border-line-soft bg-black/10 hover:border-line hover:bg-panel-2/40")}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] text-accent">{barLabel(plan.decisionBarIndex)}</span><span className="text-[11px] font-medium text-ink">{PLAN_LABELS[plan.kind]}</span><PhaseBadge phase={plan.phase} /><StatusBadge status={plan.status} /></div><p className="mt-1.5 text-[9px] text-ink-faint">事件 {plan.event ?? "未定性"} · 有效至 {barLabel(plan.validThroughBarIndex)}</p></div>
            <div className="grid min-w-[250px] grid-cols-3 gap-1.5"><Level label="入场" value={plan.entryLevel} tone="text-down" /><Level label="止损" value={plan.stopLevel} tone="text-up" /><Level label="目标" value={plan.targetLevel} tone="text-accent" /></div>
          </div>
          <p className="mt-3 rounded-[10px] border border-line-soft bg-black/10 px-3 py-2 text-[10px] leading-relaxed text-ink-dim">{plan.statusReason}</p>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <PlanList title="量价证据" tone="text-down" items={plan.evidence.map((item) => `${item.barId} · ${item.observation}`)} />
            <PlanList title="尚缺确认" tone="text-warn" items={plan.missingConfirmation} empty="无" />
            <PlanList title="失效条件" tone="text-up" items={plan.invalidation} empty="无" />
          </div>
          <span className="mt-3 inline-flex items-center gap-1 text-[9px] text-accent opacity-75 transition-opacity group-hover:opacity-100"><ScanLine size={10} /> 回到这个时点查看 K 量</span>
        </button>
      ))}
      {result.plans.length === 0 ? <div className="rounded-[14px] border border-line-soft bg-black/10 py-16 text-center text-[11px] text-ink-faint">该区间没有达到 AI 审阅门槛的 Wyckoff 结构候选</div> : null}
    </div>
  );
}

function Replay({ result, selectedPlan, onSelectPlan }: { result: AiWyckoffBacktestResult; selectedPlan: AiWyckoffPlan | null; onSelectPlan: (id: string) => void }) {
  const initialBar = selectedPlan?.decisionBarIndex ?? result.data.evaluationEndBarIndex;
  const [replayBar, setReplayBar] = useState(initialBar);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setReplayBar(selectedPlan?.decisionBarIndex ?? result.data.evaluationEndBarIndex);
    setPlaying(false);
  }, [result.id, selectedPlan?.id, selectedPlan?.decisionBarIndex, result.data.evaluationEndBarIndex]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setReplayBar((current) => {
        if (current >= result.data.evaluationEndBarIndex) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 420);
    return () => clearInterval(timer);
  }, [playing, result.data.evaluationEndBarIndex]);

  const currentPlanIndex = selectedPlan ? result.plans.findIndex((plan) => plan.id === selectedPlan.id) : -1;
  const pickAdjacentPlan = (offset: number) => {
    if (result.plans.length === 0) return;
    const base = currentPlanIndex < 0 ? 0 : currentPlanIndex;
    const next = Math.max(0, Math.min(result.plans.length - 1, base + offset));
    onSelectPlan(result.plans[next].id);
  };

  return (
    <div id="ai-backtest-panel-replay" role="tabpanel" aria-labelledby="ai-backtest-tab-replay" className="space-y-3 p-4">
      <section className="overflow-hidden rounded-[16px] border border-line-soft bg-black/15">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-3.5 py-3">
          <div><div className="flex items-center gap-2"><span className="font-mono text-[10px] text-accent">{barLabel(replayBar)}</span><h4 className="text-[11px] font-medium text-ink">{selectedPlan ? PLAN_LABELS[selectedPlan.kind] : "匿名 K 量回放"}</h4></div><p className="mt-1 text-[9px] text-ink-faint">图中永远只加载当前 BAR 及以前的数据，右侧未来不可见。</p></div>
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label="上一份计划" disabled={currentPlanIndex <= 0} onClick={() => pickAdjacentPlan(-1)} className="glass-chip rounded-[8px] p-1.5 disabled:opacity-30"><ChevronLeft size={13} /></button>
            <button type="button" aria-label={playing ? "暂停回放" : "播放回放"} onClick={() => setPlaying((value) => !value)} className="glass-chip rounded-[8px] p-1.5">{playing ? <Pause size={13} /> : <Play size={13} />}</button>
            <button type="button" aria-label="下一份计划" disabled={currentPlanIndex < 0 || currentPlanIndex >= result.plans.length - 1} onClick={() => pickAdjacentPlan(1)} className="glass-chip rounded-[8px] p-1.5 disabled:opacity-30"><ChevronRight size={13} /></button>
          </div>
        </div>
        <KVolumeReplay bars={result.replayBars} plans={result.plans} selectedPlan={selectedPlan} replayBar={replayBar} />
        <div className="border-t border-line-soft px-3.5 py-3">
          <input type="range" aria-label="回放 K 线位置" min={result.data.evaluationStartBarIndex} max={result.data.evaluationEndBarIndex} value={replayBar} onChange={(event) => { setPlaying(false); setReplayBar(Number(event.target.value)); }} className="w-full accent-[#73b6ff]" />
          <div className="mt-1 flex justify-between font-mono text-[8px] text-ink-faint"><span>{barLabel(result.data.evaluationStartBarIndex)}</span><span>NOW · {barLabel(replayBar)}</span><span>{barLabel(result.data.evaluationEndBarIndex)}</span></div>
        </div>
      </section>

      {selectedPlan ? (
        <section className="grid gap-3 rounded-[14px] border border-line-soft bg-black/10 p-3.5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div><div className="flex flex-wrap items-center gap-2"><PhaseBadge phase={selectedPlan.phase} /><StatusBadge status={selectedPlan.status} /></div><h4 className="mt-2 text-[12px] font-medium text-ink">{PLAN_LABELS[selectedPlan.kind]}</h4><p className="mt-1 font-mono text-[9px] text-ink-faint">{barLabel(selectedPlan.decisionBarIndex)} · {selectedPlan.event ?? "NO EVENT"}</p><div className="mt-3 grid grid-cols-3 gap-1.5"><Level label="入场" value={selectedPlan.entryLevel} tone="text-down" /><Level label="止损" value={selectedPlan.stopLevel} tone="text-up" /><Level label="目标" value={selectedPlan.targetLevel} tone="text-accent" /></div></div>
          <div className="grid gap-3 sm:grid-cols-3"><PlanList title="量价证据" tone="text-down" items={selectedPlan.evidence.map((item) => `${item.barId} · ${item.observation}`)} /><PlanList title="尚缺确认" tone="text-warn" items={selectedPlan.missingConfirmation} empty="无" /><PlanList title="失效条件" tone="text-up" items={selectedPlan.invalidation} empty="无" /></div>
        </section>
      ) : null}
    </div>
  );
}

function KVolumeReplay({ bars, plans, selectedPlan, replayBar }: { bars: AiWyckoffReplayBar[]; plans: AiWyckoffPlan[]; selectedPlan: AiWyckoffPlan | null; replayBar: number }) {
  const geometry = useMemo(() => makeKlineGeometry(bars, plans, selectedPlan, replayBar), [bars, plans, replayBar, selectedPlan]);
  if (!geometry) return <div className="grid min-h-[400px] place-items-center text-[11px] text-ink-faint">当前 BAR 没有可显示的 K 线</div>;
  return (
    <svg viewBox="0 0 1100 520" className="block min-h-[390px] w-full bg-[radial-gradient(circle_at_50%_0%,rgba(69,132,205,.06),transparent_55%)]" role="img" aria-label={`匿名 K 线与成交量，当前回放到 ${barLabel(replayBar)}`}>
      <defs>
        <linearGradient id="ai-chart-glow" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#73b6ff" stopOpacity=".08" /><stop offset="100%" stopColor="#73b6ff" stopOpacity="0" /></linearGradient>
        <filter id="candle-glow"><feGaussianBlur stdDeviation="1.6" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <rect x="54" y="18" width="1026" height="362" rx="8" fill="url(#ai-chart-glow)" />
      {geometry.priceGrid.map((line) => <g key={line.y}><line x1="54" x2="1080" y1={line.y} y2={line.y} stroke="rgba(185,215,255,.055)" /><text x="46" y={line.y + 3} textAnchor="end" fill="#66758d" fontSize="9" fontFamily="monospace">{line.value.toFixed(2)}</text></g>)}
      {geometry.levels.map((level) => <g key={level.label}><line x1="54" x2="1080" y1={level.y} y2={level.y} stroke={level.color} strokeOpacity=".72" strokeWidth="1" strokeDasharray="6 5" /><rect x="994" y={level.y - 10} width="86" height="18" rx="5" fill="#07101d" stroke={level.color} strokeOpacity=".45" /><text x="1037" y={level.y + 3} textAnchor="middle" fill={level.color} fontSize="9" fontFamily="monospace">{level.label} {level.value.toFixed(2)}</text></g>)}
      {geometry.candles.map((candle) => <g key={candle.barIndex} filter={candle.highlight ? "url(#candle-glow)" : undefined}><line x1={candle.x} x2={candle.x} y1={candle.highY} y2={candle.lowY} stroke={candle.color} strokeWidth="1" /><rect x={candle.x - candle.width / 2} y={candle.bodyY} width={candle.width} height={candle.bodyHeight} rx="1" fill={candle.color} opacity={candle.highlight ? 1 : .88} /></g>)}
      <line x1="54" x2="1080" y1="402" y2="402" stroke="rgba(185,215,255,.09)" />
      {geometry.volumes.map((volume) => <rect key={volume.barIndex} x={volume.x - volume.width / 2} y={volume.y} width={volume.width} height={volume.height} rx="1" fill={volume.color} opacity=".48" />)}
      {geometry.markers.map((marker) => <g key={marker.id}><line x1={marker.x} x2={marker.x} y1="22" y2="380" stroke={marker.color} strokeOpacity=".25" strokeDasharray="3 5" /><rect x={marker.x - 31} y="26" width="62" height="18" rx="6" fill="#091421" stroke={marker.color} strokeOpacity=".5" /><text x={marker.x} y="38" textAnchor="middle" fill={marker.color} fontSize="8" fontFamily="monospace">{marker.label}</text></g>)}
      <text x="54" y="506" fill="#66758d" fontSize="9" fontFamily="monospace">{barLabel(geometry.firstBar)}</text><text x="1080" y="506" textAnchor="end" fill="#8aa0bc" fontSize="9" fontFamily="monospace">{barLabel(geometry.lastBar)} · NOW</text><text x="54" y="397" fill="#66758d" fontSize="8" fontFamily="monospace">VOLUME</text>
    </svg>
  );
}

function Audit({ result, model }: { result: AiWyckoffBacktestResult; model: string }) {
  const audits = result.audit.decisionAudits;
  return (
    <div id="ai-backtest-panel-audit" role="tabpanel" aria-labelledby="ai-backtest-tab-audit" className="mx-auto max-w-5xl space-y-3 p-4 sm:p-6">
      <section className="rounded-[16px] border border-accent/20 bg-accent-soft/40 p-4">
        <div className="eyebrow">AUDITABLE AI DECISIONS</div><h4 className="mt-1 text-[14px] font-semibold text-ink">匿名 OHLCV · 单时点隔离 · 确定性成交</h4><p className="mt-2 text-[10px] leading-relaxed text-ink-dim">AI 只判断 Wyckoff 阶段、事件与计划；资金、订单、滑点、费用、止损和 T+1 不由模型控制。模型无法看到代码、日期、新闻、财报、行业、指数或未来 K 线。</p>
      </section>
      <div className="grid gap-3 sm:grid-cols-2">
        <AuditSection title="模型输入边界" items={["资产恒定映射为 ASSET_001。", "K 线以 BAR_000001 形式编号，价格按决策根收盘=100归一化。", "成交量按过去 20 根中位数归一化。", "每个决策时点独立调用，绝不把多个未来窗口放在同一提示词。", "仅提供开、高、低、收、成交量；不提供成交额或技术指标。"]} />
        <AuditSection title="计划执行规则" items={["收盘后生成的计划最早从下一根 K 线开始生效。", "做多触发、止损、目标和退出均由数值条件执行。", "同根同时触及止损与目标时按止损优先。", "沪深京标的遵守 T+1；模型并不知道真实交易所。", "模型解析失败只生成不可交易记录，不会重试到满意结果。"]} />
      </div>
      <section className="rounded-[14px] border border-line-soft bg-black/10 p-4">
        <h5 className="text-[11px] font-medium text-ink">运行快照</h5>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-[10px] sm:grid-cols-4"><Snapshot label="模型" value={model || auditText(audits[0]?.audit.model) || "未记录"} /><Snapshot label="回放引擎" value={result.engineVersion} /><Snapshot label="数据指纹" value={result.audit.dataFingerprint} /><Snapshot label="输入决策" value={`${result.audit.suppliedDecisions}`} /><Snapshot label="接受决策" value={`${result.audit.acceptedDecisions}`} /><Snapshot label="缓存命中" value={`${result.audit.cacheHits}`} /><Snapshot label="失败调用" value={`${result.audit.failedCalls}`} /><Snapshot label="复权方式" value={ADJUST_LABELS[result.settings.adjust]} /></dl>
      </section>
      <section className="rounded-[14px] border border-warn/20 bg-warn/5 p-4"><div className="flex items-center gap-2 text-[11px] font-medium text-warn"><TriangleAlert size={13} /> 结果定位</div><p className="mt-2 text-[10px] leading-relaxed text-ink-dim">这是匿名历史结构回放，用于检验 AI 对纯 K 量 Wyckoff 形态的执行一致性。当前模型仍可能记忆某些历史价格形状，因此结果不等同于严格样本外证明；从今天开始冻结模型与提示词的前向记录更可信。</p></section>
    </div>
  );
}

function AuditSection({ title, items }: { title: string; items: string[] }) {
  return <section className="rounded-[14px] border border-line-soft bg-black/10 p-4"><h5 className="text-[11px] font-medium text-ink">{title}</h5><ol className="mt-2.5 space-y-2 text-[10px] leading-relaxed text-ink-dim">{items.map((item, index) => <li key={item} className="flex gap-2"><span className="font-mono text-ink-faint">{String(index + 1).padStart(2, "0")}</span><span>{item}</span></li>)}</ol></section>;
}

function FormSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <fieldset><legend className="text-[11px] font-semibold text-ink">{title}</legend><p className="mb-2.5 mt-0.5 text-[9px] leading-relaxed text-ink-faint">{description}</p>{children}</fieldset>;
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return <div><label htmlFor={htmlFor} className="mb-1 block text-[9px] font-medium text-ink-faint">{label}</label>{children}</div>;
}

function NumberField({ id, label, value, min, max, step, suffix, onChange }: { id: string; label: string; value: string; min: number; max: number; step: number; suffix?: string; onChange: (value: string) => void }) {
  return <Field label={label} htmlFor={id}><div className="relative"><input id={id} type="number" inputMode="decimal" className={cn(INPUT_CLASS, suffix && "pr-11")} value={value} min={min} max={max} step={step} required onChange={(event) => onChange(event.target.value)} />{suffix ? <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center font-mono text-[9px] text-ink-faint">{suffix}</span> : null}</div></Field>;
}

function HistoryButton({ run, active, loading, disabled, onClick }: { run: AiWyckoffBacktestRunSummary; active: boolean; loading: boolean; disabled: boolean; onClick: () => void }) {
  const totalReturn = run.metrics?.totalReturnPct;
  return (
    <button type="button" disabled={loading || disabled} onClick={onClick} aria-current={active ? "true" : undefined} className={cn("flex w-full items-center gap-2 rounded-[10px] border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50", active ? "border-accent/25 bg-accent-soft/70" : "border-line-soft bg-white/[0.018] hover:border-line hover:bg-panel-2")}>
      {run.status === "running" || run.status === "queued" ? <Loader2 size={12} className="shrink-0 animate-spin text-accent" /> : <History size={12} className="shrink-0 text-ink-faint" />}
      <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate font-mono text-[10px] text-ink-dim">{run.asset} · {statusText(run.status)}</span><span className={cn("shrink-0 font-mono text-[9px]", totalReturn === undefined ? "text-ink-faint" : classifyChange(totalReturn))}>{totalReturn === undefined ? `${run.progressCurrent}/${run.progressTotal || "?"}` : formatPercent(totalReturn)}</span></span><span className="mt-0.5 block text-[8px] text-ink-faint">{formatDate(run.createdAt)} · {run.metrics?.planCount ?? 0} 计划 · {run.metrics?.tradeCount ?? 0} 交易</span></span>
      {loading ? <Loader2 size={11} className="shrink-0 animate-spin text-accent" /> : <ChevronRight size={11} className="shrink-0 text-ink-faint" />}
    </button>
  );
}

function MetricCard({ label, value, tone = "text-ink" }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-[13px] border border-line-soft bg-white/[0.025] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,.025)]"><dt className="text-[9px] text-ink-faint">{label}</dt><dd className={cn("mt-1 font-mono text-[15px] font-medium tabular-nums", tone)}>{value}</dd></div>;
}

function Snapshot({ label, value }: { label: string; value: string }) {
  return <div className="rounded-[10px] border border-line-soft bg-white/[0.018] px-2.5 py-2"><dt className="text-[8px] text-ink-faint">{label}</dt><dd className="mt-0.5 break-all font-mono text-[10px] tabular-nums text-ink-dim">{value}</dd></div>;
}

function Level({ label, value, tone }: { label: string; value?: number; tone: string }) {
  return <div className="rounded-[9px] border border-line-soft bg-black/15 px-2 py-1.5"><span className="block text-[8px] text-ink-faint">{label}</span><span className={cn("mt-0.5 block font-mono text-[10px] tabular-nums", value === undefined ? "text-ink-faint" : tone)}>{value === undefined ? "—" : value.toFixed(2)}</span></div>;
}

function PhaseBadge({ phase }: { phase: AiWyckoffPlan["phase"] }) {
  return <span className="rounded-md border border-accent/20 bg-accent-soft px-1.5 py-0.5 font-mono text-[8px] text-accent">PHASE {phase}</span>;
}

function StatusBadge({ status }: { status: AiWyckoffPlan["status"] }) {
  const tone = status === "closed" || status === "executed" ? "border-down/20 bg-down/5 text-down" : status === "invalidated" ? "border-up/20 bg-up/5 text-up" : status === "expired" || status === "superseded" ? "border-warn/20 bg-warn/5 text-warn" : "border-line bg-white/[.03] text-ink-dim";
  return <span className={cn("rounded-md border px-1.5 py-0.5 text-[8px]", tone)}>{STATUS_LABELS[status]}</span>;
}

function PlanList({ title, tone, items, empty = "暂无" }: { title: string; tone: string; items: string[]; empty?: string }) {
  return <div><h5 className={cn("text-[9px] font-medium", tone)}>{title}</h5>{items.length > 0 ? <ul className="mt-1.5 space-y-1 text-[9px] leading-relaxed text-ink-dim">{items.map((item, index) => <li key={`${index}-${item}`} className="flex gap-1.5"><span className="text-ink-faint">•</span><span>{item}</span></li>)}</ul> : <p className="mt-1.5 text-[9px] text-ink-faint">{empty}</p>}</div>;
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return <span className="inline-flex items-center gap-1.5"><span className={cn("h-px w-4", dashed && "border-t border-dashed bg-transparent")} style={dashed ? { borderColor: color } : { backgroundColor: color }} />{label}</span>;
}

function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number, setTab: (tab: ResultTab) => void) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const offset = event.key === "ArrowRight" ? 1 : -1;
  const nextIndex = (index + offset + TABS.length) % TABS.length;
  setTab(TABS[nextIndex].id);
  document.getElementById(`ai-backtest-tab-${TABS[nextIndex].id}`)?.focus();
}

function makeEquityGeometry(curve: AiWyckoffCurvePoint[]) {
  if (curve.length === 0) return null;
  const values = curve.flatMap((point) => [point.equity, point.benchmarkEquity]);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = Math.max((high - low) * 0.1, high * 0.01, 1);
  const min = low - pad;
  const max = high + pad;
  const left = 58;
  const right = 980;
  const top = 18;
  const bottom = 258;
  const x = (index: number) => left + (index / Math.max(1, curve.length - 1)) * (right - left);
  const y = (value: number) => bottom - ((value - min) / Math.max(1e-9, max - min)) * (bottom - top);
  const path = (pick: (point: AiWyckoffCurvePoint) => number) => curve.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(pick(point)).toFixed(2)}`).join(" ");
  const equity = path((point) => point.equity);
  return {
    equity,
    benchmark: path((point) => point.benchmarkEquity),
    area: `${equity} L${right},${bottom} L${left},${bottom} Z`,
    grid: Array.from({ length: 5 }, (_, index) => {
      const ratio = index / 4;
      return { y: top + ratio * (bottom - top), value: max - ratio * (max - min) };
    }),
  };
}

function makeKlineGeometry(bars: AiWyckoffReplayBar[], plans: AiWyckoffPlan[], selectedPlan: AiWyckoffPlan | null, replayBar: number) {
  const visible = bars.filter((bar) => bar.barIndex <= replayBar).slice(-90);
  if (visible.length === 0) return null;
  const left = 64;
  const right = 1070;
  const priceTop = 54;
  const priceBottom = 376;
  const volumeTop = 416;
  const volumeBottom = 486;
  const rawMin = Math.min(...visible.map((bar) => bar.low));
  const rawMax = Math.max(...visible.map((bar) => bar.high));
  const pad = Math.max((rawMax - rawMin) * 0.08, rawMax * 0.002, 0.01);
  const min = rawMin - pad;
  const max = rawMax + pad;
  const slot = (right - left) / visible.length;
  const width = Math.max(1.5, Math.min(8, slot * 0.58));
  const xAt = (index: number) => left + (index + 0.5) * slot;
  const yAt = (value: number) => priceBottom - ((value - min) / Math.max(1e-9, max - min)) * (priceBottom - priceTop);
  const maxVolume = Math.max(...visible.map((bar) => bar.volume), 1);
  const selectedIndex = selectedPlan?.decisionBarIndex;

  const candles = visible.map((bar, index) => {
    const up = bar.close >= bar.open;
    const openY = yAt(bar.open);
    const closeY = yAt(bar.close);
    return { barIndex: bar.barIndex, x: xAt(index), highY: yAt(bar.high), lowY: yAt(bar.low), bodyY: Math.min(openY, closeY), bodyHeight: Math.max(1.4, Math.abs(closeY - openY)), width, color: up ? "#ff6178" : "#28d9a9", highlight: bar.barIndex === selectedIndex };
  });
  const volumes = visible.map((bar, index) => {
    const height = Math.max(1, (bar.volume / maxVolume) * (volumeBottom - volumeTop));
    return { barIndex: bar.barIndex, x: xAt(index), y: volumeBottom - height, height, width, color: bar.close >= bar.open ? "#ff6178" : "#28d9a9" };
  });
  const indexByBar = new Map(visible.map((bar, index) => [bar.barIndex, index]));
  const markers = plans.flatMap((plan) => {
    const index = indexByBar.get(plan.decisionBarIndex);
    if (index === undefined || plan.decisionBarIndex > replayBar) return [];
    return [{ id: plan.id, x: xAt(index), label: plan.event ?? shortPlanLabel(plan.kind), color: plan.id === selectedPlan?.id ? "#73b6ff" : plan.action === "enter_long" ? "#28d9a9" : plan.action === "exit_long" ? "#ff6178" : "#8a99ad" }];
  });
  const levelSpecs = selectedPlan && selectedPlan.decisionBarIndex <= replayBar ? [
    { label: "ENTRY", value: selectedPlan.entryLevel, color: "#28d9a9" },
    { label: "STOP", value: selectedPlan.stopLevel, color: "#ff6178" },
    { label: "TARGET", value: selectedPlan.targetLevel, color: "#73b6ff" },
  ] : [];
  const levels = levelSpecs.flatMap((level) => level.value === undefined ? [] : [{ ...level, value: level.value, y: clamp(yAt(level.value), priceTop, priceBottom) }]);
  return {
    candles,
    volumes,
    markers,
    levels,
    firstBar: visible[0].barIndex,
    lastBar: visible.at(-1)!.barIndex,
    priceGrid: Array.from({ length: 6 }, (_, index) => {
      const ratio = index / 5;
      return { y: priceTop + ratio * (priceBottom - priceTop), value: max - ratio * (max - min) };
    }),
  };
}

function createDraft(adjust: AdjustType): Draft {
  const endDate = todayDate();
  const start = new Date(`${endDate}T00:00:00.000Z`);
  start.setUTCFullYear(start.getUTCFullYear() - 3);
  return {
    adjust,
    startDate: start.toISOString().slice(0, 10),
    endDate,
    initialCapital: "100000",
    positionSizePct: "100",
    commissionBps: "5",
    slippageBps: "5",
    maxHoldingBars: "60",
    contextBars: "160",
    rangeLookback: "40",
    planValidBars: "5",
    maxAiDecisions: "16",
    minDecisionGapBars: "5",
  };
}

function toRequest(symbol: string, draft: Draft) {
  return {
    symbol,
    period: "1d" as const,
    adjust: draft.adjust,
    startTime: dateTimestamp(draft.startDate),
    endTime: dateTimestamp(draft.endDate, true),
    initialCapital: draft.initialCapital,
    positionSizePct: draft.positionSizePct,
    commissionBps: draft.commissionBps,
    slippageBps: draft.slippageBps,
    maxHoldingBars: draft.maxHoldingBars,
    contextBars: draft.contextBars,
    rangeLookback: draft.rangeLookback,
    planValidBars: draft.planValidBars,
    maxAiDecisions: draft.maxAiDecisions,
    minDecisionGapBars: draft.minDecisionGapBars,
  };
}

function updateDraft<K extends keyof Draft>(setDraft: React.Dispatch<React.SetStateAction<Draft>>, key: K, value: Draft[K]) {
  setDraft((current) => ({ ...current, [key]: value }));
}

function todayDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function dateTimestamp(value: string, endOfDay = false): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp + (endOfDay ? 86_399_999 : 0) : undefined;
}

function barLabel(index: number): string {
  return `BAR_${String(index + 1).padStart(6, "0")}`;
}

function shortPlanLabel(kind: AiWyckoffPlanKind): string {
  if (kind === "spring_test_long") return "SPRING";
  if (kind === "sos_lps_long") return "SOS/LPS";
  if (kind === "reaccumulation_long") return "RE-ACC";
  if (kind === "ut_utad_exit") return "UTAD";
  if (kind === "sow_lpsy_exit") return "SOW";
  return "OBSERVE";
}

function statusText(status: AiWyckoffBacktestRunSummary["status"]): string {
  if (status === "queued") return "等待运行";
  if (status === "running") return "正在生成计划";
  if (status === "completed") return "已完成";
  return "运行失败";
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 }).format(value);
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function signedNumber(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}`;
}

function auditText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
