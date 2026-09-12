import {
  ADJUST_LABELS,
  ADJUST_TYPES,
  PERIOD_LABELS,
  PERIODS,
  backtestRequestSchema,
  type AdjustType,
  type BacktestCurvePoint,
  type BacktestResult,
  type BacktestRunSummary,
  type BacktestStrategy,
  type BacktestTrade,
  type Period,
} from "@wyckoff/shared";
import {
  Activity,
  BarChart3,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Clock3,
  History,
  Loader2,
  Play,
  RefreshCw,
  Table2,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  memo,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { fetchBacktest, fetchBacktests, runBacktest } from "@/lib/api.js";
import {
  classifyChange,
  cn,
  formatDate,
  formatDateTime,
  formatPercent,
  formatPrice,
  isIntradayPeriod,
} from "@/lib/utils.js";

interface BacktestPanelProps {
  open: boolean;
  onClose: () => void;
  symbol: string;
  period: Period;
  adjust: AdjustType;
}

type ResultTab = "overview" | "trades" | "method";
type StrategyType = BacktestStrategy["type"];

interface BacktestDraft {
  period: Period;
  adjust: AdjustType;
  startDate: string;
  endDate: string;
  initialCapital: string;
  positionSizePct: string;
  commissionBps: string;
  slippageBps: string;
  stopLossPct: string;
  takeProfitPct: string;
  maxHoldingBars: string;
  strategyType: StrategyType;
  fastPeriod: string;
  slowPeriod: string;
  rangeLookback: string;
  maxRangeEfficiency: string;
  breakoutBufferPct: string;
  volumeLookback: string;
  volumeMultiplier: string;
}

const RESULT_TABS: Array<{ id: ResultTab; label: string; icon: typeof Activity }> = [
  { id: "overview", label: "概览", icon: BarChart3 },
  { id: "trades", label: "交易明细", icon: Table2 },
  { id: "method", label: "方法说明", icon: BookOpen },
];

const INPUT_CLASS =
  "glass-input h-9 w-full px-2.5 font-mono text-[11px] tabular-nums text-ink [color-scheme:dark] disabled:cursor-not-allowed disabled:opacity-50";
const NUMBER_FORMAT = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const COMPACT_NUMBER_FORMAT = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 });

export function BacktestPanel({ open, onClose, symbol, period, adjust }: BacktestPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const historyRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const [draft, setDraft] = useState<BacktestDraft>(() => createDraft(period, adjust));
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [runs, setRuns] = useState<BacktestRunSummary[]>([]);
  const [tab, setTab] = useState<ResultTab>("overview");
  const [running, setRunning] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshHistory = useCallback(async () => {
    const requestId = ++historyRequestRef.current;
    setHistoryLoading(true);
    try {
      const response = await fetchBacktests(20);
      if (historyRequestRef.current === requestId) setRuns(response.runs);
    } catch (cause) {
      if (historyRequestRef.current === requestId) setError(errorMessage(cause, "读取回测记录失败"));
    } finally {
      if (historyRequestRef.current === requestId) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setDraft((current) => ({ ...current, period, adjust }));
    void refreshHistory();
  }, [open, period, adjust, refreshHistory]);

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
  }, [open, onClose]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = backtestRequestSchema.safeParse(toRequest(symbol, draft));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "请检查回测参数");
      return;
    }

    // 新运行拥有最高优先级，任何仍在途的历史详情都不能覆盖它。
    detailRequestRef.current++;
    setDetailLoadingId(null);
    setRunning(true);
    setError(null);
    try {
      const response = await runBacktest(parsed.data);
      setResult(response.result);
      setTab("overview");
      void refreshHistory();
    } catch (cause) {
      setError(errorMessage(cause, "回测运行失败"));
    } finally {
      setRunning(false);
    }
  };

  const loadRun = async (id: string) => {
    if (running) return;
    const requestId = ++detailRequestRef.current;
    setDetailLoadingId(id);
    setError(null);
    try {
      const response = await fetchBacktest(id);
      if (detailRequestRef.current === requestId) {
        setResult(response.result);
        setTab("overview");
      }
    } catch (cause) {
      if (detailRequestRef.current === requestId) setError(errorMessage(cause, "读取回测详情失败"));
    } finally {
      if (detailRequestRef.current === requestId) setDetailLoadingId(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#02050b]/80 p-2 backdrop-blur-md sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="backtest-title"
        aria-describedby="backtest-description"
        className="glass-panel-strong modal-glass grid h-full max-h-[940px] w-full max-w-[1480px] grid-rows-[minmax(330px,44%)_minmax(0,1fr)] overflow-hidden rounded-[22px] animate-rise lg:grid-cols-[330px_minmax(0,1fr)] lg:grid-rows-1"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <aside className="flex min-h-0 flex-col border-b border-line-soft lg:border-b-0 lg:border-r">
          <div className="panel-header flex items-start justify-between gap-3 border-b border-line-soft px-4 py-3.5">
            <div className="min-w-0">
              <div className="eyebrow">STRATEGY LAB</div>
              <h2 id="backtest-title" className="mt-0.5 text-[15px] font-semibold text-ink">
                历史回测
              </h2>
              <p id="backtest-description" className="mt-0.5 truncate text-[10px] text-ink-faint">
                {symbol} · 收盘信号、下一根开盘成交
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
              <FormSection title="数据范围" description="回测固定使用当前标的，周期和复权可独立调整。">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="周期" htmlFor="backtest-period">
                    <select
                      id="backtest-period"
                      className={INPUT_CLASS}
                      value={draft.period}
                      onChange={(event) => updateDraft(setDraft, "period", event.target.value as Period)}
                    >
                      {PERIODS.map((value) => (
                        <option key={value} value={value}>{PERIOD_LABELS[value]}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="复权" htmlFor="backtest-adjust">
                    <select
                      id="backtest-adjust"
                      className={INPUT_CLASS}
                      value={draft.adjust}
                      onChange={(event) => updateDraft(setDraft, "adjust", event.target.value as AdjustType)}
                    >
                      {ADJUST_TYPES.map((value) => (
                        <option key={value} value={value}>{ADJUST_LABELS[value]}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="开始日期" htmlFor="backtest-start-date">
                    <input
                      id="backtest-start-date"
                      type="date"
                      className={INPUT_CLASS}
                      value={draft.startDate}
                      max={draft.endDate}
                      onChange={(event) => updateDraft(setDraft, "startDate", event.target.value)}
                    />
                  </Field>
                  <Field label="结束日期" htmlFor="backtest-end-date">
                    <input
                      id="backtest-end-date"
                      type="date"
                      className={INPUT_CLASS}
                      value={draft.endDate}
                      min={draft.startDate}
                      max={todayDate()}
                      onChange={(event) => updateDraft(setDraft, "endDate", event.target.value)}
                    />
                  </Field>
                </div>
              </FormSection>

              <FormSection title="策略" description="先从可审计的规则策略开始，所有参数会随结果固化。">
                <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="回测策略">
                  <StrategyButton
                    value="wyckoff_breakout"
                    active={draft.strategyType === "wyckoff_breakout"}
                    title="Wyckoff 突破"
                    detail="区间 · 量能确认"
                    onClick={() => updateDraft(setDraft, "strategyType", "wyckoff_breakout")}
                  />
                  <StrategyButton
                    value="ma_cross"
                    active={draft.strategyType === "ma_cross"}
                    title="均线交叉"
                    detail="规则基准策略"
                    onClick={() => updateDraft(setDraft, "strategyType", "ma_cross")}
                  />
                </div>
                {draft.strategyType === "ma_cross" ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <NumberField id="backtest-fast" label="快线" value={draft.fastPeriod} min={2} max={200} step={1} onChange={(value) => updateDraft(setDraft, "fastPeriod", value)} />
                    <NumberField id="backtest-slow" label="慢线" value={draft.slowPeriod} min={3} max={500} step={1} onChange={(value) => updateDraft(setDraft, "slowPeriod", value)} />
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <NumberField id="backtest-range" label="区间回看" value={draft.rangeLookback} min={10} max={250} step={1} suffix="根" onChange={(value) => updateDraft(setDraft, "rangeLookback", value)} />
                    <NumberField id="backtest-efficiency" label="最大效率比" value={draft.maxRangeEfficiency} min={0.05} max={1} step={0.05} onChange={(value) => updateDraft(setDraft, "maxRangeEfficiency", value)} />
                    <NumberField id="backtest-buffer" label="突破缓冲" value={draft.breakoutBufferPct} min={0} max={5} step={0.1} suffix="%" onChange={(value) => updateDraft(setDraft, "breakoutBufferPct", value)} />
                    <NumberField id="backtest-volume-lookback" label="量能回看" value={draft.volumeLookback} min={5} max={100} step={1} suffix="根" onChange={(value) => updateDraft(setDraft, "volumeLookback", value)} />
                    <NumberField id="backtest-volume-multiple" label="量能倍数" value={draft.volumeMultiplier} min={0.1} max={10} step={0.1} suffix="×" onChange={(value) => updateDraft(setDraft, "volumeMultiplier", value)} />
                  </div>
                )}
              </FormSection>

              <FormSection title="资金与风险" description="成本按基点计，买卖双边收取。">
                <div className="grid grid-cols-2 gap-2">
                  <NumberField id="backtest-capital" label="初始资金" value={draft.initialCapital} min={1000} max={1_000_000_000} step={1000} onChange={(value) => updateDraft(setDraft, "initialCapital", value)} />
                  <NumberField id="backtest-position" label="单次仓位" value={draft.positionSizePct} min={1} max={100} step={1} suffix="%" onChange={(value) => updateDraft(setDraft, "positionSizePct", value)} />
                  <NumberField id="backtest-stop" label="止损" value={draft.stopLossPct} min={0.1} max={50} step={0.1} suffix="%" onChange={(value) => updateDraft(setDraft, "stopLossPct", value)} />
                  <NumberField id="backtest-take" label="止盈" value={draft.takeProfitPct} min={0.1} max={200} step={0.1} suffix="%" onChange={(value) => updateDraft(setDraft, "takeProfitPct", value)} />
                  <NumberField id="backtest-hold" label="最长持有" value={draft.maxHoldingBars} min={1} max={2000} step={1} suffix="根" onChange={(value) => updateDraft(setDraft, "maxHoldingBars", value)} />
                  <NumberField id="backtest-commission" label="佣金" value={draft.commissionBps} min={0} max={100} step={1} suffix="bps" onChange={(value) => updateDraft(setDraft, "commissionBps", value)} />
                  <NumberField id="backtest-slippage" label="滑点" value={draft.slippageBps} min={0} max={100} step={1} suffix="bps" onChange={(value) => updateDraft(setDraft, "slippageBps", value)} />
                </div>
              </FormSection>

              <FormSection title="最近运行" description="只加载摘要，点选时再读取完整曲线与交易。">
                <div className="space-y-1.5">
                  {historyLoading && runs.length === 0 ? (
                    <div className="flex items-center gap-2 py-3 text-[11px] text-ink-faint">
                      <Loader2 size={12} className="animate-spin" /> 读取记录…
                    </div>
                  ) : runs.length === 0 ? (
                    <p className="py-3 text-[11px] text-ink-faint">还没有历史回测</p>
                  ) : runs.map((run) => (
                    <HistoryRunButton
                      key={run.id}
                      run={run}
                      active={result?.id === run.id}
                      loading={detailLoadingId === run.id}
                      disabled={running}
                      onClick={() => void loadRun(run.id)}
                    />
                  ))}
                </div>
              </FormSection>
            </div>

            <div className="border-t border-line-soft bg-black/10 p-3">
              <button
                type="submit"
                disabled={running}
                className="glass-btn-primary flex h-10 w-full items-center justify-center gap-2 rounded-[11px] text-[12px]"
              >
                {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
                {running ? "正在计算历史路径…" : `运行 ${symbol} 回测`}
              </button>
              <p className="mt-2 text-center text-[9px] leading-relaxed text-ink-faint">
                结果用于研究规则表现，不构成未来收益承诺。
              </p>
            </div>
          </form>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col">
          <div className="panel-header flex min-h-[66px] items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Activity size={14} className="shrink-0 text-accent" />
                <h3 className="truncate text-[13px] font-semibold text-ink">
                  {result ? `${result.request.symbol} · ${result.strategyName}` : "回测结果"}
                </h3>
              </div>
              <p className="mt-1 truncate font-mono text-[9px] text-ink-faint">
                {result
                  ? `${formatBacktestTime(result.data.startTime, result.request.period)} → ${formatBacktestTime(result.data.endTime, result.request.period)} · ${result.data.barCount} 根 · 规则引擎 ${result.engineVersion}（无 AI）`
                  : "设置左侧参数并运行，结果会在这里展开"}
              </p>
            </div>
            <button
              type="button"
              disabled={historyLoading}
              title="刷新历史记录"
              aria-label="刷新历史记录"
              onClick={() => void refreshHistory()}
              className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-40"
            >
              <RefreshCw size={14} className={historyLoading ? "animate-spin" : undefined} />
            </button>
          </div>

          <div role="tablist" aria-label="回测结果视图" className="flex items-center gap-1 border-b border-line-soft px-3 py-2">
            {RESULT_TABS.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  id={`backtest-tab-${item.id}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  aria-controls={`backtest-panel-${item.id}`}
                  tabIndex={tab === item.id ? 0 : -1}
                  disabled={!result}
                  onClick={() => setTab(item.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index, setTab)}
                  className={cn(
                    "glass-chip inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-35",
                    tab === item.id && "glass-chip-active",
                  )}
                >
                  <Icon size={12} /> {item.label}
                  {item.id === "trades" && result ? (
                    <span className="font-mono text-[9px] opacity-65">{result.trades.length}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="relative min-h-0 flex-1 overflow-y-auto">
            {error ? (
              <div role="alert" className="mx-4 mt-4 flex items-start gap-2 rounded-[12px] border border-up/25 bg-up/5 px-3 py-2.5 text-[11px] text-up">
                <TriangleAlert size={14} className="mt-0.5 shrink-0" />
                <span className="leading-relaxed">{error}</span>
              </div>
            ) : null}

            {running && !result ? <LoadingResult /> : null}
            {!running && !result ? <EmptyResult /> : null}
            {result && tab === "overview" ? <OverviewTab result={result} /> : null}
            {result && tab === "trades" ? <TradesTab key={result.id} trades={result.trades} period={result.request.period} /> : null}
            {result && tab === "method" ? <MethodTab result={result} /> : null}

            <div className="sr-only" aria-live="polite">
              {running ? "回测正在运行" : result ? `回测完成，共 ${result.metrics.tradeCount} 笔交易` : ""}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

const OverviewTab = memo(function OverviewTab({ result }: { result: BacktestResult }) {
  const { metrics } = result;
  const finalEquity = result.request.initialCapital * (1 + metrics.totalReturnPct / 100);
  return (
    <div
      id="backtest-panel-overview"
      role="tabpanel"
      aria-labelledby="backtest-tab-overview"
      className="space-y-4 p-4"
    >
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-5">
        <MetricCard label="累计收益" value={formatPercent(metrics.totalReturnPct)} tone={classifyChange(metrics.totalReturnPct)} />
        <MetricCard label="基准收益" value={formatPercent(metrics.benchmarkReturnPct)} tone={classifyChange(metrics.benchmarkReturnPct)} />
        <MetricCard label="超额收益" value={formatPercent(metrics.excessReturnPct)} tone={classifyChange(metrics.excessReturnPct)} />
        <MetricCard label="最大回撤" value={formatDrawdown(metrics.maxDrawdownPct)} tone="text-warn" />
        <MetricCard
          label="年化收益"
          value={formatOptionalPercent(metrics.annualizedReturnPct)}
          tone={metrics.annualizedReturnPct === null ? "text-ink-dim" : classifyChange(metrics.annualizedReturnPct)}
        />
        <MetricCard label="Sharpe" value={formatDecimal(metrics.sharpeRatio)} />
        <MetricCard label="胜率" value={`${metrics.winRatePct.toFixed(1)}%`} />
        <MetricCard label="盈亏比" value={metrics.profitFactor === null ? "—" : formatDecimal(metrics.profitFactor)} />
        <MetricCard label="交易 / 暴露" value={`${metrics.tradeCount} / ${metrics.exposurePct.toFixed(1)}%`} />
        <MetricCard label="期末权益" value={formatMoney(finalEquity)} />
      </dl>

      <EquityCurve curve={result.curve} metrics={result.metrics} period={result.request.period} />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-[14px] border border-line-soft bg-black/10 p-3.5">
          <div className="flex items-center gap-2 text-[11px] font-medium text-ink">
            <Clock3 size={13} className="text-accent" /> 数据与执行快照
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-[10px] sm:grid-cols-4">
            <SnapshotItem label="K 线数量" value={`${result.data.barCount} 根`} />
            <SnapshotItem
              label="实际 / 所需预热"
              value={`${result.data.actualWarmupBars ?? result.data.warmupBars} / ${result.data.warmupBars} 根`}
            />
            <SnapshotItem label="单次仓位" value={`${result.request.positionSizePct}%`} />
            <SnapshotItem label="总手续费" value={formatMoney(result.metrics.totalFees)} />
            <SnapshotItem label="平均单笔" value={formatPercent(result.metrics.averageTradePct)} />
            <SnapshotItem label="平均持有" value={`${result.metrics.averageHoldingBars.toFixed(1)} 根`} />
            <SnapshotItem label="年化波动" value={formatOptionalPercent(result.metrics.annualizedVolatilityPct)} />
            <SnapshotItem label="复权方式" value={ADJUST_LABELS[result.request.adjust]} />
            <SnapshotItem label="行情来源" value={result.data.source ?? "历史缓存"} />
            <SnapshotItem label="行情指纹" value={result.data.fingerprint ?? "旧版结果未记录"} />
          </dl>
        </section>

        <section className="rounded-[14px] border border-line-soft bg-black/10 p-3.5">
          <div className="flex items-center gap-2 text-[11px] font-medium text-ink">
            <TriangleAlert size={13} className="text-warn" /> 运行提示
          </div>
          {result.warnings.length ? (
            <ul className="mt-2.5 space-y-1.5 text-[10px] leading-relaxed text-ink-dim">
              {result.warnings.map((warning) => <li key={warning}>• {warning}</li>)}
            </ul>
          ) : (
            <p className="mt-2.5 text-[10px] leading-relaxed text-ink-faint">本次运行没有额外数据质量提示。</p>
          )}
        </section>
      </div>
    </div>
  );
});

function EquityCurve({ curve, metrics, period }: { curve: BacktestCurvePoint[]; metrics: BacktestResult["metrics"]; period: Period }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const chart = useMemo(() => createChartGeometry(curve, period), [curve, period]);
  const hover = hoverIndex === null ? null : curve[hoverIndex];

  if (!chart) {
    return (
      <section className="rounded-[14px] border border-line-soft bg-black/10 p-8 text-center text-[11px] text-ink-faint">
        没有可绘制的权益数据
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-[14px] border border-line-soft bg-black/10">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-3.5 py-3">
        <div>
          <h4 className="text-[11px] font-medium text-ink">权益曲线与回撤</h4>
          <p className="mt-0.5 text-[9px] text-ink-faint">策略与买入持有基准均以初始资金归一</p>
        </div>
        <div className="flex items-center gap-3 font-mono text-[9px] text-ink-faint" aria-hidden="true">
          <Legend color="#73b6ff" label="策略权益" />
          <Legend color="#7d8ba0" label="买入持有" dashed />
          <Legend color="#f2ba62" label="回撤" />
        </div>
      </div>
      <div className="relative px-2 pb-2 pt-1">
        <svg
          viewBox="0 0 1000 330"
          className="block h-auto min-h-[260px] w-full"
          role="img"
          aria-label={`权益曲线。累计收益 ${formatPercent(metrics.totalReturnPct)}，基准 ${formatPercent(metrics.benchmarkReturnPct)}，最大回撤 ${Math.abs(metrics.maxDrawdownPct).toFixed(2)}%。`}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const x = ((event.clientX - rect.left) / rect.width) * 1000;
            const ratio = clamp((x - chart.left) / chart.width, 0, 1);
            setHoverIndex(Math.round(ratio * (curve.length - 1)));
          }}
          onPointerLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id="backtest-equity-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#73b6ff" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#73b6ff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="backtest-drawdown-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f2ba62" stopOpacity="0.05" />
              <stop offset="100%" stopColor="#f2ba62" stopOpacity="0.32" />
            </linearGradient>
          </defs>

          {chart.grid.map((line) => (
            <g key={line.y}>
              <line x1={chart.left} x2={chart.right} y1={line.y} y2={line.y} stroke="rgba(185,215,255,.075)" strokeWidth="1" />
              <text x={chart.left - 8} y={line.y + 3} textAnchor="end" fill="#66758d" fontSize="9" fontFamily="IBM Plex Mono, monospace">
                {formatCompact(line.value)}
              </text>
            </g>
          ))}
          <line x1={chart.left} x2={chart.right} y1={chart.drawdownTop} y2={chart.drawdownTop} stroke="rgba(185,215,255,.1)" strokeWidth="1" />
          <text x={chart.left - 8} y={chart.drawdownTop + 4} textAnchor="end" fill="#66758d" fontSize="8" fontFamily="IBM Plex Mono, monospace">DD</text>

          <path d={chart.equityArea} fill="url(#backtest-equity-fill)" />
          <path d={chart.benchmarkPath} fill="none" stroke="#7d8ba0" strokeOpacity=".75" strokeWidth="1.4" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
          <path d={chart.equityPath} fill="none" stroke="#73b6ff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <path d={chart.drawdownArea} fill="url(#backtest-drawdown-fill)" stroke="#f2ba62" strokeOpacity=".8" strokeWidth="1" vectorEffect="non-scaling-stroke" />

          {chart.dateLabels.map((label) => (
            <text key={`${label.x}-${label.text}`} x={label.x} y="323" textAnchor={label.anchor} fill="#66758d" fontSize="9" fontFamily="IBM Plex Mono, monospace">
              {label.text}
            </text>
          ))}

          {hover && hoverIndex !== null ? (
            <g aria-hidden="true">
              <line x1={chart.xAt(hoverIndex)} x2={chart.xAt(hoverIndex)} y1={chart.top} y2={chart.bottom} stroke="rgba(238,245,255,.22)" strokeWidth="1" strokeDasharray="3 3" />
              <circle cx={chart.xAt(hoverIndex)} cy={chart.equityY(hover.equity)} r="3.5" fill="#73b6ff" stroke="#06101d" strokeWidth="1.5" />
            </g>
          ) : null}
        </svg>

        {hover ? (
          <div className="pointer-events-none absolute right-4 top-3 rounded-[10px] border border-line bg-[#09111f]/92 px-3 py-2 font-mono text-[9px] leading-relaxed text-ink-dim shadow-xl backdrop-blur-xl">
            <div className="mb-1 text-ink">{formatBacktestTime(hover.timestamp, period)}</div>
            <div>策略 {formatMoney(hover.equity)}</div>
            <div>基准 {formatMoney(hover.benchmarkEquity)}</div>
            <div className="text-warn">回撤 {hover.drawdownPct.toFixed(2)}%</div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

const TradesTab = memo(function TradesTab({ trades, period }: { trades: BacktestTrade[]; period: Period }) {
  const pageSize = 50;
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(trades.length / pageSize));
  const pageTrades = trades.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div id="backtest-panel-trades" role="tabpanel" aria-labelledby="backtest-tab-trades" className="min-w-0">
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-[10px] text-ink-faint">
        <span>收益已扣除双边佣金和滑点；正收益为红、负收益为绿。</span>
        <span className="shrink-0 font-mono">{trades.length} 笔</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] border-collapse">
          <caption className="sr-only">回测交易明细</caption>
          <thead className="sticky top-0 z-10 bg-[#0a111e]/95 backdrop-blur-xl">
            <tr className="text-left text-[10px] text-ink-faint">
              <th scope="col" className="px-3 py-2 font-medium">#</th>
              <th scope="col" className="px-3 py-2 font-medium">信号 / 入场</th>
              <th scope="col" className="px-3 py-2 font-medium">入场价</th>
              <th scope="col" className="px-3 py-2 font-medium">出场</th>
              <th scope="col" className="px-3 py-2 font-medium">出场价</th>
              <th scope="col" className="px-3 py-2 font-medium">数量</th>
              <th scope="col" className="px-3 py-2 font-medium">净收益</th>
              <th scope="col" className="px-3 py-2 font-medium">收益率</th>
              <th scope="col" className="px-3 py-2 font-medium">费用</th>
              <th scope="col" className="px-3 py-2 font-medium">持有</th>
              <th scope="col" className="px-3 py-2 font-medium">退出原因</th>
            </tr>
          </thead>
          <tbody>
            {pageTrades.map((trade, index) => (
              <tr key={trade.id} className="border-b border-line-soft transition-colors last:border-0 hover:bg-panel-2/50">
                <td className="px-3 py-2 font-mono text-[10px] text-ink-faint">{page * pageSize + index + 1}</td>
                <td className="px-3 py-2">
                  <div className="font-mono text-[11px] text-ink-dim">{formatBacktestTime(trade.entryTime, period)}</div>
                  <div className="mt-0.5 max-w-[190px] truncate text-[9px] text-ink-faint" title={trade.entryReason}>
                    {formatBacktestTime(trade.entrySignalTime, period)} 信号 · {trade.entryReason}
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-ink-dim">{formatPrice(trade.entryPrice)}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-ink-dim">{formatBacktestTime(trade.exitTime, period)}</td>
                <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-ink-dim">{formatPrice(trade.exitPrice)}</td>
                <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-ink-faint">{formatCompact(trade.quantity)}</td>
                <td className={cn("px-3 py-2 font-mono text-[11px] tabular-nums", classifyChange(trade.netPnl))}>{formatSignedMoney(trade.netPnl)}</td>
                <td className={cn("px-3 py-2 font-mono text-[11px] tabular-nums", classifyChange(trade.returnPct))}>{formatPercent(trade.returnPct)}</td>
                <td className="px-3 py-2 font-mono text-[10px] tabular-nums text-ink-faint">{formatMoney(trade.fees)}</td>
                <td className="px-3 py-2 font-mono text-[10px] tabular-nums text-ink-faint">{trade.holdingBars} 根</td>
                <td className="max-w-[220px] px-3 py-2 text-[10px] leading-relaxed text-ink-dim" title={trade.exitReasonText}>{trade.exitReasonText}</td>
              </tr>
            ))}
            {trades.length === 0 ? (
              <tr><td colSpan={11} className="px-4 py-16 text-center text-[11px] text-ink-faint">这组参数没有触发完整交易</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {trades.length > pageSize ? (
        <div className="flex items-center justify-end gap-2 border-t border-line-soft px-4 py-3">
          <button type="button" aria-label="上一页" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} className="glass-chip rounded-[8px] p-1.5 disabled:opacity-35"><ChevronLeft size={13} /></button>
          <span className="font-mono text-[10px] text-ink-faint">{page + 1} / {pages}</span>
          <button type="button" aria-label="下一页" disabled={page + 1 >= pages} onClick={() => setPage((value) => Math.min(pages - 1, value + 1))} className="glass-chip rounded-[8px] p-1.5 disabled:opacity-35"><ChevronRight size={13} /></button>
        </div>
      ) : null}
    </div>
  );
});

const MethodTab = memo(function MethodTab({ result }: { result: BacktestResult }) {
  const request = result.request;
  const usesTPlusOneSettlement = /\.(?:SH|SZ|BJ)$/i.test(request.symbol);
  let entryRules: string[];
  let exitRules: string[];
  if (request.strategy.type === "ma_cross") {
    entryRules = [`${request.strategy.fastPeriod} 根简单均线由下向上穿越 ${request.strategy.slowPeriod} 根简单均线时产生入场信号。`];
    exitRules = ["快线由上向下穿越慢线时策略退出。"];
  } else {
    entryRules = [
      `只用当前 K 线之前 ${request.strategy.rangeLookback} 根数据构造候选区间，效率比不高于 ${request.strategy.maxRangeEfficiency}。`,
      `收盘突破历史阻力 ${request.strategy.breakoutBufferPct}% 且成交量不低于前 ${request.strategy.volumeLookback} 根均量的 ${request.strategy.volumeMultiplier} 倍时产生信号。`,
    ];
    exitRules = ["收盘重新跌回入场时确认的原阻力位后，下一根 K 线开盘退出。"];
  }

  return (
    <div id="backtest-panel-method" role="tabpanel" aria-labelledby="backtest-tab-method" className="mx-auto max-w-4xl space-y-3 p-4 sm:p-6">
      <section className="rounded-[16px] border border-accent/20 bg-accent-soft/40 p-4">
        <div className="eyebrow">REPRODUCIBLE METHOD</div>
        <h4 className="mt-1 text-[14px] font-semibold text-ink">{result.strategyName}</h4>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">{result.strategyDescription}</p>
        <p className="mt-2 text-[10px] leading-relaxed text-accent">本结果由确定性规则引擎生成，AI 未参与历史信号、参数调整或成交。</p>
        <p className="mt-2 font-mono text-[9px] text-ink-faint">运行 ID {result.id} · 引擎 {result.engineVersion}</p>
      </section>

      <MethodSection title="入场规则" items={entryRules} />
      <MethodSection
        title="退出规则"
        items={[
          ...exitRules,
          `止损 ${request.stopLossPct}% · 止盈 ${request.takeProfitPct}% · 最长持有 ${request.maxHoldingBars} 根，任一先发生即退出。`,
        ]}
      />
      <MethodSection
        title="成交与成本假设"
        items={[
          "信号在当前 K 线收盘后生成，策略入场和信号退出均在下一根 K 线开盘成交，避免使用未来信息。",
          `买入价向上计 ${request.slippageBps} bps、卖出价向下计 ${request.slippageBps} bps；佣金 ${request.commissionBps} bps，买卖双边计入。`,
          usesTPlusOneSettlement
            ? "沪深京股票按 T+1 模拟：买入当根不可卖出，止盈止损从下一根 K 线开始；其他市场开仓当根即可触发风控。"
            : "开仓后的同一根 K 线即可触发止盈或止损；若高低价同时触及两者，按更保守的止损优先。",
          "止损向下跳空按开盘价成交；止盈向上跳空仍按目标价成交，避免高估。",
          "末根仍持有的仓位按末根收盘价结算并标记为数据结束，这是下一根开盘成交规则的唯一例外。",
        ]}
      />
      <MethodSection
        title="统计口径"
        items={[
          "基准为首根收盘买入并持有至数据结束，不计交易成本。",
          "年化收益按首末 K 线的真实日历跨度计算；波动率与 Sharpe 使用逐 K 线权益收益、无风险利率为 0，并按本次样本的实际 K 线密度换算。少于 30 个自然日时不展示年化值。",
          `行情内容指纹 ${result.data.fingerprint ?? "旧版结果未记录"}；它用于发现缓存或复权序列发生修订。`,
          `初始资金 ${formatMoney(request.initialCapital)}，每次使用可用权益的 ${request.positionSizePct}%，不叠加同时持仓。`,
        ]}
      />
      <MethodSection
        title="局限性"
        items={[
          "历史回测不能证明未来收益；成交量、停牌、涨跌停、流动性和税费等现实约束可能未被完整模拟。",
          "复权价格适合比较收益路径，但可能不是历史真实可成交报价；判断时应结合原始行情与企业行动。",
        ]}
      />
    </div>
  );
});

function FormSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="text-[11px] font-semibold text-ink">{title}</legend>
      <p className="mb-2.5 mt-0.5 text-[9px] leading-relaxed text-ink-faint">{description}</p>
      {children}
    </fieldset>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-[9px] font-medium text-ink-faint">{label}</label>
      {children}
    </div>
  );
}

function NumberField({ id, label, value, min, max, step, suffix, onChange }: { id: string; label: string; value: string; min: number; max: number; step: number; suffix?: string; onChange: (value: string) => void }) {
  return (
    <Field label={label} htmlFor={id}>
      <div className="relative">
        <input id={id} type="number" inputMode="decimal" className={cn(INPUT_CLASS, suffix && "pr-11")} value={value} min={min} max={max} step={step} required onChange={(event) => onChange(event.target.value)} />
        {suffix ? <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center font-mono text-[9px] text-ink-faint">{suffix}</span> : null}
      </div>
    </Field>
  );
}

function StrategyButton({ value, active, title, detail, onClick }: { value: StrategyType; active: boolean; title: string; detail: string; onClick: () => void }) {
  return (
    <label className={cn("cursor-pointer rounded-[11px] border px-2.5 py-2 text-left transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/60", active ? "border-accent/35 bg-accent-soft text-ink" : "border-line-soft bg-white/[0.025] text-ink-dim hover:border-line hover:bg-panel-2")}>
      <input
        className="sr-only"
        type="radio"
        name="backtest-strategy"
        value={value}
        checked={active}
        onChange={onClick}
        onKeyDown={handleStrategyKeyDown}
      />
      <span className="block text-[10px] font-medium">{title}</span>
      <span className="mt-0.5 block text-[8px] text-ink-faint">{detail}</span>
    </label>
  );
}

function HistoryRunButton({ run, active, loading, disabled, onClick }: { run: BacktestRunSummary; active: boolean; loading: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={loading || disabled} onClick={onClick} aria-current={active ? "true" : undefined} className={cn("flex w-full items-center gap-2 rounded-[10px] border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50", active ? "border-accent/25 bg-accent-soft/70" : "border-line-soft bg-white/[0.018] hover:border-line hover:bg-panel-2")}>
      <History size={12} className="shrink-0 text-ink-faint" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[10px] text-ink-dim">{run.symbol} · {run.strategyName}</span>
          <span className={cn("shrink-0 font-mono text-[9px]", classifyChange(run.totalReturnPct))}>{formatPercent(run.totalReturnPct)}</span>
        </span>
        <span className="mt-0.5 block text-[8px] text-ink-faint">{formatDate(run.createdAt)} · {run.tradeCount} 笔 · DD {formatDrawdown(run.maxDrawdownPct, 1)}</span>
      </span>
      {loading ? <Loader2 size={11} className="shrink-0 animate-spin text-accent" /> : <ChevronRight size={11} className="shrink-0 text-ink-faint" />}
    </button>
  );
}

function MetricCard({ label, value, tone = "text-ink" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-[13px] border border-line-soft bg-white/[0.025] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,.025)]">
      <dt className="text-[9px] text-ink-faint">{label}</dt>
      <dd className={cn("mt-1 font-mono text-[15px] font-medium tabular-nums", tone)}>{value}</dd>
    </div>
  );
}

function SnapshotItem({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-ink-faint">{label}</dt><dd className="mt-0.5 font-mono tabular-nums text-ink-dim">{value}</dd></div>;
}

function MethodSection({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-[14px] border border-line-soft bg-black/10 p-4">
      <h5 className="text-[11px] font-medium text-ink">{title}</h5>
      <ol className="mt-2.5 space-y-2 text-[10px] leading-relaxed text-ink-dim">
        {items.map((item, index) => <li key={item} className="flex gap-2"><span className="font-mono text-ink-faint">{String(index + 1).padStart(2, "0")}</span><span>{item}</span></li>)}
      </ol>
    </section>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return <span className="inline-flex items-center gap-1.5"><span className={cn("h-px w-4", dashed && "border-t border-dashed bg-transparent")} style={dashed ? { borderColor: color } : { backgroundColor: color }} />{label}</span>;
}

function EmptyResult() {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-[18px] border border-accent/20 bg-accent-soft text-accent"><BarChart3 size={23} /></div>
      <h4 className="mt-4 text-[13px] font-medium text-ink">用历史路径检验规则</h4>
      <p className="mt-2 max-w-sm text-[10px] leading-relaxed text-ink-faint">选择策略、成本与风险参数后运行。系统会保留参数快照、权益曲线和每一笔交易，方便复现而不是只看一个收益数字。</p>
    </div>
  );
}

function LoadingResult() {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
      <Loader2 size={24} className="animate-spin text-accent" />
      <h4 className="mt-4 text-[12px] font-medium text-ink">正在重放历史 K 线</h4>
      <p className="mt-1.5 text-[10px] text-ink-faint">计算信号、成交、成本与逐根权益路径…</p>
    </div>
  );
}

function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number, setTab: (tab: ResultTab) => void) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const offset = event.key === "ArrowRight" ? 1 : -1;
  const nextIndex = (index + offset + RESULT_TABS.length) % RESULT_TABS.length;
  setTab(RESULT_TABS[nextIndex].id);
  document.getElementById(`backtest-tab-${RESULT_TABS[nextIndex].id}`)?.focus();
}

function handleStrategyKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const group = event.currentTarget.closest('[role="radiogroup"]');
  const radios = group ? Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]')) : [];
  const index = radios.indexOf(event.currentTarget);
  if (index < 0 || radios.length < 2) return;
  const offset = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
  const next = radios[(index + offset + radios.length) % radios.length];
  next.click();
  next.focus();
}

function createDraft(period: Period, adjust: AdjustType): BacktestDraft {
  const endDate = todayDate();
  const start = new Date(`${endDate}T00:00:00.000Z`);
  start.setUTCFullYear(start.getUTCFullYear() - 3);
  return {
    period,
    adjust,
    startDate: start.toISOString().slice(0, 10),
    endDate,
    initialCapital: "100000",
    positionSizePct: "100",
    commissionBps: "5",
    slippageBps: "5",
    stopLossPct: "8",
    takeProfitPct: "20",
    maxHoldingBars: "120",
    strategyType: "wyckoff_breakout",
    fastPeriod: "20",
    slowPeriod: "60",
    rangeLookback: "40",
    maxRangeEfficiency: "0.35",
    breakoutBufferPct: "0.3",
    volumeLookback: "20",
    volumeMultiplier: "1.2",
  };
}

function toRequest(symbol: string, draft: BacktestDraft) {
  const strategy = draft.strategyType === "ma_cross"
    ? { type: "ma_cross", fastPeriod: draft.fastPeriod, slowPeriod: draft.slowPeriod }
    : {
        type: "wyckoff_breakout",
        rangeLookback: draft.rangeLookback,
        maxRangeEfficiency: draft.maxRangeEfficiency,
        breakoutBufferPct: draft.breakoutBufferPct,
        volumeLookback: draft.volumeLookback,
        volumeMultiplier: draft.volumeMultiplier,
      };
  return {
    symbol,
    period: draft.period,
    adjust: draft.adjust,
    startTime: dateTimestamp(draft.startDate),
    endTime: dateTimestamp(draft.endDate, true),
    initialCapital: draft.initialCapital,
    positionSizePct: draft.positionSizePct,
    commissionBps: draft.commissionBps,
    slippageBps: draft.slippageBps,
    stopLossPct: draft.stopLossPct,
    takeProfitPct: draft.takeProfitPct,
    maxHoldingBars: draft.maxHoldingBars,
    strategy,
  };
}

function updateDraft<K extends keyof BacktestDraft>(setDraft: React.Dispatch<React.SetStateAction<BacktestDraft>>, key: K, value: BacktestDraft[K]) {
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

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function formatDecimal(value: number | null): string {
  if (value === null) return "—";
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}

function formatOptionalPercent(value: number | null): string {
  return value === null ? "—" : formatPercent(value);
}

function formatBacktestTime(timestamp: number, period: Period): string {
  return formatDateTime(timestamp, isIntradayPeriod(period));
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return NUMBER_FORMAT.format(value);
}

function formatSignedMoney(value: number): string {
  return `${value > 0 ? "+" : ""}${formatMoney(value)}`;
}

function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return COMPACT_NUMBER_FORMAT.format(value);
}

function formatDrawdown(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  return value === 0 ? `${value.toFixed(digits)}%` : `-${Math.abs(value).toFixed(digits)}%`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createChartGeometry(curve: BacktestCurvePoint[], period: Period) {
  if (curve.length === 0) return null;
  const left = 62;
  const right = 986;
  const top = 18;
  const mainBottom = 235;
  const drawdownTop = 257;
  const bottom = 307;
  const width = right - left;

  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  let maxDrawdown = 0;
  for (const point of curve) {
    minimum = Math.min(minimum, point.equity, point.benchmarkEquity);
    maximum = Math.max(maximum, point.equity, point.benchmarkEquity);
    maxDrawdown = Math.max(maxDrawdown, Math.abs(point.drawdownPct));
  }
  const spread = Math.max(maximum - minimum, Math.abs(maximum) * 0.02, 1);
  minimum -= spread * 0.08;
  maximum += spread * 0.08;

  const xAt = (index: number) => left + (curve.length === 1 ? 0 : (index / (curve.length - 1)) * width);
  const equityY = (value: number) => top + ((maximum - value) / (maximum - minimum)) * (mainBottom - top);
  const drawdownY = (value: number) => drawdownTop + (Math.abs(value) / Math.max(maxDrawdown, 0.01)) * (bottom - drawdownTop);
  const linePath = (field: "equity" | "benchmarkEquity") => curve.map((point, index) => `${index === 0 ? "M" : "L"}${xAt(index).toFixed(2)},${equityY(point[field]).toFixed(2)}`).join(" ");
  const equityPath = linePath("equity");
  const benchmarkPath = linePath("benchmarkEquity");
  const equityArea = `${equityPath} L${xAt(curve.length - 1).toFixed(2)},${mainBottom} L${left},${mainBottom} Z`;
  const drawdownLine = curve.map((point, index) => `${index === 0 ? "M" : "L"}${xAt(index).toFixed(2)},${drawdownY(point.drawdownPct).toFixed(2)}`).join(" ");
  const drawdownArea = `${drawdownLine} L${right},${drawdownTop} L${left},${drawdownTop} Z`;
  const grid = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    return { y: top + ratio * (mainBottom - top), value: maximum - ratio * (maximum - minimum) };
  });
  const dateLabels = [
    { x: left, text: formatBacktestTime(curve[0].timestamp, period), anchor: "start" as const },
    { x: left + width / 2, text: formatBacktestTime(curve[Math.floor((curve.length - 1) / 2)].timestamp, period), anchor: "middle" as const },
    { x: right, text: formatBacktestTime(curve[curve.length - 1].timestamp, period), anchor: "end" as const },
  ];

  return { left, right, top, bottom, width, drawdownTop, equityPath, benchmarkPath, equityArea, drawdownArea, grid, dateLabels, xAt, equityY };
}
