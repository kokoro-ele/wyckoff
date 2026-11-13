import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Chart, DataLoaderGetBarsParams, KLineData, Overlay } from "klinecharts";
import { dispose, init } from "klinecharts";
import { Activity, Star } from "lucide-react";
import type { Kline, StoredAnnotation } from "@wyckoff/shared";
import { ApiError, fetchKlines } from "@/lib/api.js";
import { overlayToAnnotation, renderAnnotations, USER_GROUP_ID } from "@/chart/annotations.js";
import { registerWyckoffOverlays, setOverlayLanguage } from "@/chart/overlays.js";
import { barsForTimeSpan, timeSpanDays, toChartPeriod } from "@/chart/period.js";
import { getChartStyles } from "@/chart/theme.js";
import { INDICATORS, useWorkbench, type IndicatorId } from "@/store.js";
import { cn, localizedInstrumentName } from "@/lib/utils.js";
import { ChartToolbar } from "./ChartToolbar.js";
import { AnnotationEvidence, type AnnotationStats } from "./AnnotationEvidence.js";

import { chartContextKey } from "@/chart/context.js";
import { useTheme } from "@/theme.js";
import { useI18n } from "@/i18n.js";
import { useAuth } from "@/auth/AuthProvider.js";

interface SelectionRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface MarketSnapshot {
  price: number;
  changePct: number | null;
}

function toChartBar(k: Kline) {
  return {
    timestamp: k.timestamp,
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
    volume: k.volume,
    turnover: k.amount,
  };
}

export function ChartPanel() {
  const { lang } = useI18n();
  const key = useWorkbench(chartContextKey);
  // Language changes reinitialize the chart so its locale and the annotation
  // captions switch together.
  return <ChartContextPanel key={`${key}|${lang}`} />;
}

function ChartContextPanel() {
  const { theme } = useTheme();
  const { t, lang } = useI18n();
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const readyRef = useRef(false);
  const ready = status === "ready";
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const paneIds = useRef<Map<IndicatorId, string>>(new Map());
  const loadingKey = useRef("");
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<SelectionRect | null>(null);
  const [marketSnapshot, setMarketSnapshot] = useState<MarketSnapshot | null>(null);
  const [rangeChange, setRangeChange] = useState<number | null>(null);
  const [evidence, setEvidence] = useState<{ annotation: StoredAnnotation; bar?: KLineData; stats?: AnnotationStats } | null>(null);

  const symbol = useWorkbench((s) => s.symbol);
  const chartRevision = useWorkbench((s) => s.chartRevision);
  const instrumentName = useWorkbench((s) => s.instrumentName);
  const instrumentNameEn = useWorkbench((s) => s.instrumentNameEn);
  const period = useWorkbench((s) => s.period);
  const adjust = useWorkbench((s) => s.adjust);
  const timeSpan = useWorkbench((s) => s.timeSpan);
  const indicators = useWorkbench((s) => s.indicators);
  const activeTool = useWorkbench((s) => s.activeTool);
  const selectionMode = useWorkbench((s) => s.selectionMode);
  const annotations = useWorkbench((s) => s.annotations);
  const annotationGroups = useWorkbench((s) => s.annotationGroups);
  const focusRequest = useWorkbench((s) => s.focusRequest);
  const setPendingContext = useWorkbench((s) => s.setPendingContext);
  const registerUserAnnotation = useWorkbench((s) => s.registerUserAnnotation);
  const consumeFocus = useWorkbench((s) => s.consumeFocus);
  const notify = useWorkbench((s) => s.notify);
  const setActiveTool = useWorkbench((s) => s.setActiveTool);

  // —— 初始化图表 ——
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    registerWyckoffOverlays();
    const chart = init(el, { styles: getChartStyles(theme), locale: lang === "en" ? "en-US" : "zh-CN", timezone: "Asia/Shanghai" });
    if (!chart) { setError(t("chart.initError")); setStatus("error"); return; }
    chartRef.current = chart;

    chart.setDataLoader({
      getBars: async (params: DataLoaderGetBarsParams) => {
        const state = useWorkbench.getState();
        const key = chartContextKey(state);
        loadingKey.current = key;
        const current = () => chartRef.current === chart && chartContextKey(useWorkbench.getState()) === key && loadingKey.current === key;
        try {
          let bars: Kline[] = [];
          if (params.type === "init" || params.type === "update") {
            const count = barsForTimeSpan(state.timeSpan, state.period);
            const res = await fetchKlines({
              symbol: state.symbol,
              period: state.period,
              adjust: state.adjust,
              count: Math.max(count, 500),
            });
            bars = res.klines;
          } else if (params.type === "forward" && params.timestamp != null) {
            const res = await fetchKlines({
              symbol: state.symbol,
              period: state.period,
              adjust: state.adjust,
              endTime: params.timestamp - 1,
              count: 500,
            });
            bars = res.klines;
          } else {
            params.callback([], false);
            return;
          }

          if (!current()) return;
          setError(null);
          if ((params.type === "init" || params.type === "update") && bars.length > 0) {
            const latest = bars[bars.length - 1];
            const previous = bars[bars.length - 2];
            setMarketSnapshot({
              price: latest.close,
              changePct: previous?.close
                ? ((latest.close - previous.close) / previous.close) * 100
                : null,
            });
          }
          const moreForward = bars.length >= 500;
          params.callback(bars.map(toChartBar), { forward: moreForward });
          if (params.type === "init" || params.type === "update") {
            readyRef.current = bars.length > 0;
            setStatus(bars.length ? "ready" : "empty");
            if (!bars.length) setMarketSnapshot(null);
          }

          // 数据到位后按时间跨度调整可视密度
          requestAnimationFrame(() => { if (current()) fitTimeSpan(chart, state.timeSpan); });
        } catch (err) {
          if (!current()) return;
          const message =
            err instanceof ApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : t("chart.error");
          setError(message);
          if (params.type === "init" || params.type === "update") {
            readyRef.current = false;
            setMarketSnapshot(null);
            setStatus("error");
          }
          params.callback([], false);
          notify(message, "error");
        }
      },
    });

    const onBarClick = (raw: unknown) => {
      if (!readyRef.current || useWorkbench.getState().selectionMode) return;
      const payload = raw as { data?: { current?: { timestamp?: number } }; timestamp?: number };
      const ts = payload?.data?.current?.timestamp ?? payload?.timestamp;
      if (typeof ts === "number") {
        useWorkbench.getState().setPendingContext({ kind: "bar", timestamp: ts });
        useWorkbench.getState().notify(t("chart.barSelected"));
      }
    };
    chart.subscribeAction("onCandleBarClick", onBarClick);

    const onVisibleRange = () => {
      if (!readyRef.current) return;
      const data = chart.getDataList();
      const range = chart.getVisibleRange();
      if (!data.length) return;
      const from = Math.max(0, Math.floor(range.from));
      const to = Math.min(data.length - 1, Math.floor(range.to));
      const start = data[from];
      const end = data[to];
      if (start && end) {
        useWorkbench.getState().setViewport({ startTime: start.timestamp, endTime: end.timestamp });
        setRangeChange(start.close > 0 ? ((end.close - start.close) / start.close) * 100 : null);
      }
    };
    chart.subscribeAction("onVisibleRangeChange", onVisibleRange);

    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);

    return () => {
      chart.unsubscribeAction("onCandleBarClick", onBarClick);
      chart.unsubscribeAction("onVisibleRangeChange", onVisibleRange);
      ro.disconnect();
      dispose(el);
      chartRef.current = null;
      paneIds.current.clear();
    };
  }, []);

  useEffect(() => { chartRef.current?.setStyles(getChartStyles(theme)); }, [theme]);

  // Clear every overlay before painting a different analysis context, including unfinished drawings.
  useLayoutEffect(() => {
    chartRef.current?.removeOverlay();
    setSelecting(null);
    setError(null);
    setEvidence(null);
  }, [chartRevision]);

  // —— 标的 / 周期变化时触发 DataLoader 重新拉取 ——
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    setMarketSnapshot(null);
    setRangeChange(null);
    chart.setSymbol({ ticker: symbol, pricePrecision: 2, volumePrecision: 0 });
    chart.setPeriod(toChartPeriod(period));
  }, [symbol, period]);

  // —— 指标 ——
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    for (const ind of INDICATORS) {
      const exists = paneIds.current.has(ind.id);
      const wanted = indicators.includes(ind.id);
      if (wanted && !exists) {
        const id =
          ind.pane === "candle"
            ? chart.createIndicator({ name: ind.id, calcParams: ind.id === "MA" ? [5, 10, 20, 60] : undefined }, true)
            : chart.createIndicator(ind.id, false);
        if (id) paneIds.current.set(ind.id, id);
      } else if (!wanted && exists) {
        const id = paneIds.current.get(ind.id);
        chart.removeIndicator(id ? { id } : { name: ind.id });
        paneIds.current.delete(ind.id);
      }
    }
  }, [indicators]);

  // —— 手动绘图工具 ——
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (!activeTool || !ready) return;

    const drawingRevision = useWorkbench.getState().chartRevision;
    chart.createOverlay({
      name: activeTool,
      groupId: USER_GROUP_ID,
      onDrawEnd: (event) => {
        if (useWorkbench.getState().chartRevision !== drawingRevision) return true;
        const overlay = event.overlay as Overlay;
        const annotation = overlayToAnnotation(overlay);
        if (annotation) {
          void registerUserAnnotation(annotation).catch((err: unknown) => {
            notify(err instanceof Error ? err.message : t("chart.annotationError"), "error");
          });
        }
        setActiveTool(null);
        return true;
      },
    });
  }, [activeTool, registerUserAnnotation, setActiveTool, notify, ready]);

  // —— 语义标注渲染 ——
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !ready) return;
    const visibleIds = new Set(annotationGroups.filter((g) => g.visible).map((g) => g.groupId));
    const visible: StoredAnnotation[] = annotations.filter((a) => visibleIds.has(a.groupId));

    setOverlayLanguage(lang);
    renderAnnotations(chart, visible, lang, (annotation) => {
      const data = chart.getDataList() as KLineData[];
      const target =
        annotation.kind === "event"
          ? annotation.timestamp
          : annotation.kind === "zone"
            ? annotation.endTime
            : annotation.kind === "level"
              ? annotation.endTime ?? annotation.startTime
              : annotation.points[1].timestamp;
      let index = data.findIndex((bar) => bar.timestamp === target);
      if (index < 0 && target !== undefined) {
        index = data.reduce((best, bar, i) => {
          const distance = Math.abs(bar.timestamp - target);
          return distance < Math.abs(data[best].timestamp - target) ? i : best;
        }, 0);
      }
      const bar = data[index];
      let stats: AnnotationStats | undefined;
      if (bar && index >= 0) {
        const prior = data.slice(Math.max(0, index - 20), index);
        const avgVolume = prior.length ? prior.reduce((sum, item) => sum + (item.volume ?? 0), 0) / prior.length : 0;
        const avgSpread = prior.length ? prior.reduce((sum, item) => sum + (item.high - item.low), 0) / prior.length : 0;
        const previous = data[index - 1];
        const spread = bar.high - bar.low;
        stats = {
          volumeRatio: avgVolume > 0 ? (bar.volume ?? 0) / avgVolume : null,
          spreadRatio: avgSpread > 0 ? spread / avgSpread : null,
          closePosition: spread > 0 ? (bar.close - bar.low) / spread : null,
          changePct: previous && previous.close > 0 ? ((bar.close - previous.close) / previous.close) * 100 : null,
        };
      }
      setEvidence({ annotation, bar, stats });
    });
  }, [annotations, annotationGroups, chartRevision, ready, lang]);

  // —— Agent 请求聚焦某段区间 ——
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !focusRequest || !ready) return;
    const { startTime, endTime } = focusRequest;
    const mid = (startTime + endTime) / 2;
    const data = chart.getDataList();
    const spanBars = data.filter((d) => d.timestamp >= startTime && d.timestamp <= endTime).length;
    const width = containerRef.current?.clientWidth ?? 800;
    if (spanBars > 0) {
      chart.setBarSpace(Math.max(3, Math.min(24, width / (spanBars + 8))));
    }
    chart.scrollToTimestamp(mid, 200);
    consumeFocus();
  }, [focusRequest, consumeFocus, ready]);

  // —— 框选模式 ——
  const onSelectStart = (e: React.MouseEvent) => {
    if (!ready || !selectionMode || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setSelecting({ x0: x, y0: y, x1: x, y1: y });
  };

  const onSelectMove = (e: React.MouseEvent) => {
    if (!selecting || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setSelecting({ ...selecting, x1: e.clientX - rect.left, y1: e.clientY - rect.top });
  };

  const onSelectEnd = () => {
    const chart = chartRef.current;
    if (!selecting || !chart) {
      setSelecting(null);
      return;
    }
    const left = Math.min(selecting.x0, selecting.x1);
    const right = Math.max(selecting.x0, selecting.x1);
    const top = Math.min(selecting.y0, selecting.y1);
    const bottom = Math.max(selecting.y0, selecting.y1);
    setSelecting(null);

    if (right - left < 8 || bottom - top < 8) return;

    const points = chart.convertFromPixel(
      [
        { x: left, y: top },
        { x: right, y: bottom },
      ],
      { paneId: "candle_pane" },
    );
    const arr = Array.isArray(points) ? points : [points];
    const a = arr[0];
    const b = arr[1] ?? arr[0];
    if (!a?.timestamp || !b?.timestamp) return;

    const startTime = Math.min(a.timestamp, b.timestamp);
    const endTime = Math.max(a.timestamp, b.timestamp);
    const prices = [a.value, b.value].filter((v): v is number => typeof v === "number");
    setPendingContext({
      kind: "range",
      startTime,
      endTime,
      priceLow: prices.length ? Math.min(...prices) : undefined,
      priceHigh: prices.length ? Math.max(...prices) : undefined,
    });
    notify(t("chart.selected"));
    useWorkbench.getState().toggleSelectionMode();
  };

  return (
    <main data-tour="chart" className="glass-panel chart-panel flex min-w-0 flex-1 flex-col overflow-hidden rounded-[20px]">
      <div className="panel-header flex min-h-[67px] flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="market-mark" aria-hidden="true">
            <Activity size={15} />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2.5">
              <h1 className="truncate font-mono text-[18px] font-semibold tracking-[-0.03em] text-ink">{symbol}</h1>
              <span className="truncate text-[12px] text-ink-dim">
                {localizedInstrumentName(instrumentName, lang, "", instrumentNameEn)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-ink-faint">
              <span className="market-status-dot" />
              <span>{t(`period.${period}`)}</span>
              <span className="text-line">/</span>
              <span>{t(`adjust.${adjust}`)}</span>
              <span className="text-line">/</span>
              <span>{t(`span.${timeSpan}`)}</span>
              {rangeChange !== null && (
                <>
                  <span className="text-line">/</span>
                  <span className={cn("font-mono", rangeChange >= 0 ? "text-up" : "text-down")}>
                    {rangeChange >= 0 ? "+" : ""}{rangeChange.toFixed(2)}%
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ready && marketSnapshot && (
            <div className="market-quote text-right">
              <div className="font-mono text-[17px] font-medium tabular-nums text-ink">
                {marketSnapshot.price.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              {marketSnapshot.changePct !== null && (
                <div
                  className={cn(
                    "font-mono text-[10px] font-medium tabular-nums",
                    marketSnapshot.changePct >= 0 ? "text-up" : "text-down",
                  )}
                >
                  {marketSnapshot.changePct >= 0 ? "+" : ""}{marketSnapshot.changePct.toFixed(2)}%
                </div>
              )}
            </div>
          )}
          {ready && selectionMode && (
            <span className="rounded-[8px] border border-accent/30 bg-accent-soft px-2.5 py-1 text-[11px] text-accent">
              {t("chart.selecting")}
            </span>
          )}
          <WatchStarButton />
        </div>
      </div>

      <ChartToolbar dataReady={ready} />

      <div className="chart-surface relative min-h-0 flex-1">
        <div className="chart-reflection pointer-events-none absolute inset-0 z-[1]" />
        <div ref={containerRef} className="absolute inset-0" style={{ visibility: ready ? "visible" : "hidden" }} aria-hidden={!ready} />

        {evidence && (
          <AnnotationEvidence
            annotation={evidence.annotation}
            bar={evidence.bar}
            stats={evidence.stats}
            onClose={() => setEvidence(null)}
          />
        )}

        {ready && selectionMode && (
          <div
            className="absolute inset-0 z-10 cursor-crosshair"
            onMouseDown={onSelectStart}
            onMouseMove={onSelectMove}
            onMouseUp={onSelectEnd}
            onMouseLeave={() => setSelecting(null)}
          >
            {selecting && (
              <div
                className="pointer-events-none absolute border border-accent bg-accent/10"
                style={{
                  left: Math.min(selecting.x0, selecting.x1),
                  top: Math.min(selecting.y0, selecting.y1),
                  width: Math.abs(selecting.x1 - selecting.x0),
                  height: Math.abs(selecting.y1 - selecting.y0),
                }}
              />
            )}
          </div>
        )}

        {!ready && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-panel px-8 text-center" role="status" aria-live="polite" aria-busy={status === "loading"}>
            {status === "loading" && <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-accent" />}
            <p className="text-sm text-ink">
              {status === "loading"
                ? t("chart.loading", { symbol })
                : status === "empty"
                  ? t("chart.empty")
                  : t("chart.error")}
            </p>
            <p className="max-w-md text-xs text-ink-dim">
              {status === "error"
                ? error
                : status === "empty"
                  ? t("chart.emptyHint")
                  : `${t(`period.${period}`)} · ${t(`adjust.${adjust}`)}`}
            </p>
            {status !== "loading" && (
              <button
                className="hand-btn hand-btn-primary rounded-lg px-4 py-2 text-xs"
                onClick={() => {
                  setError(null);
                  setStatus("loading");
                  chartRef.current?.resetData();
                }}
              >
                {t("chart.retry")}
              </button>
            )}
          </div>
        )}
        {ready && error && <div role="status" className="absolute inset-x-0 top-4 z-20 flex justify-center"><div className="glass-panel-strong rounded-lg px-3 py-2 text-xs text-up">{t("chart.error")}: {error}</div></div>}
      </div>
    </main>
  );
}

function WatchStarButton() {
  const { t } = useI18n();
  const { isVerified, requireAuth } = useAuth();
  const symbol = useWorkbench((s) => s.symbol);
  const watched = useWorkbench((s) => s.watchItems.some((item) => item.symbol === symbol));
  const activeWatchGroupId = useWorkbench((s) => s.activeWatchGroupId);
  const watchGroups = useWorkbench((s) => s.watchGroups);
  const toggleWatch = useWorkbench((s) => s.toggleWatch);
  const rawGroupName = watchGroups.find((g) => g.id === activeWatchGroupId)?.name;
  const groupName = !rawGroupName || rawGroupName === "自选" || rawGroupName === "Watchlist" ? t("watch.title") : rawGroupName;

  return (
    <button
      type="button"
      title={watched ? t("chart.removeFavorite") : t("chart.addTo", { group: groupName })}
      className={cn(
        "glass-icon-btn inline-flex items-center gap-1.5 rounded-[11px] border px-2.5 py-1.5 text-[11px] transition-colors",
        watched
          ? "border-warn/35 bg-warn/10 text-warn"
          : "border-line bg-panel-2 text-ink-dim hover:border-warn/30 hover:text-warn",
      )}
      onClick={() => {
        if (!isVerified) {
          requireAuth(() => {
            void useWorkbench
              .getState()
              .refreshWatchlist()
              .then(() => useWorkbench.getState().toggleWatch({ symbol }))
              .catch(() => undefined);
          });
          return;
        }
        void toggleWatch({ symbol });
      }}
    >
      <Star size={13} fill={watched ? "currentColor" : "none"} />
      {watched ? t("chart.favorited") : t("chart.favorite")}
    </button>
  );
}

function fitTimeSpan(chart: Chart, span: ReturnType<typeof useWorkbench.getState>["timeSpan"]) {
  const data = chart.getDataList();
  if (data.length === 0) return;
  const days = timeSpanDays(span);
  const last = data[data.length - 1].timestamp;
  let fromIdx = 0;
  if (days !== null) {
    const cutoff = last - days * 86_400_000;
    const found = data.findIndex((d) => d.timestamp >= cutoff);
    fromIdx = found >= 0 ? found : 0;
  }
  const count = Math.max(data.length - fromIdx, 20);
  const width = chart.getSize()?.width ?? 800;
  chart.setBarSpace(Math.max(2, Math.min(22, (width - 60) / count)));
  chart.scrollToRealTime();
}
