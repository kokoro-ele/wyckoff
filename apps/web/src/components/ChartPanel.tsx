import { useEffect, useRef, useState } from "react";
import type { Chart, DataLoaderGetBarsParams, Overlay } from "klinecharts";
import { dispose, init } from "klinecharts";
import { Activity, ChartNoAxesCombined, Star } from "lucide-react";
import { ADJUST_LABELS, PERIOD_LABELS, TIME_SPANS, type Kline, type StoredAnnotation } from "@wyckoff/shared";
import { ApiError, fetchKlines } from "@/lib/api.js";
import { overlayToAnnotation, renderAnnotations, USER_GROUP_ID } from "@/chart/annotations.js";
import { registerWyckoffOverlays } from "@/chart/overlays.js";
import { barsForTimeSpan, timeSpanDays, toChartPeriod } from "@/chart/period.js";
import { chartStyles } from "@/chart/theme.js";
import { INDICATORS, useWorkbench, type IndicatorId } from "@/store.js";
import { cn } from "@/lib/utils.js";
import { ChartToolbar } from "./ChartToolbar.js";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const paneIds = useRef<Map<IndicatorId, string>>(new Map());
  const loadingKey = useRef("");
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<SelectionRect | null>(null);
  const [marketSnapshot, setMarketSnapshot] = useState<MarketSnapshot | null>(null);

  const symbol = useWorkbench((s) => s.symbol);
  const instrumentName = useWorkbench((s) => s.instrumentName);
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
  const setBacktestOpen = useWorkbench((s) => s.setBacktestOpen);

  // —— 初始化图表 ——
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    registerWyckoffOverlays();
    const chart = init(el, { styles: chartStyles, locale: "zh-CN", timezone: "Asia/Shanghai" });
    if (!chart) return;
    chartRef.current = chart;

    chart.setDataLoader({
      getBars: async (params: DataLoaderGetBarsParams) => {
        const state = useWorkbench.getState();
        const key = `${state.symbol}|${state.period}|${state.adjust}`;
        loadingKey.current = key;
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

          if (loadingKey.current !== key) return;
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

          // 数据到位后按时间跨度调整可视密度
          requestAnimationFrame(() => fitTimeSpan(chart, state.timeSpan));
        } catch (err) {
          if (loadingKey.current !== key) return;
          const message =
            err instanceof ApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : "加载行情失败";
          setError(message);
          params.callback([], false);
          notify(message, "error");
        }
      },
    });

    const onBarClick = (raw: unknown) => {
      if (useWorkbench.getState().selectionMode) return;
      const payload = raw as { data?: { current?: { timestamp?: number } }; timestamp?: number };
      const ts = payload?.data?.current?.timestamp ?? payload?.timestamp;
      if (typeof ts === "number") {
        useWorkbench.getState().setPendingContext({ kind: "bar", timestamp: ts });
        useWorkbench.getState().notify("已选中一根 K 线，可在对话中提问");
      }
    };
    chart.subscribeAction("onCandleBarClick", onBarClick);

    const onVisibleRange = () => {
      const data = chart.getDataList();
      const range = chart.getVisibleRange();
      if (!data.length) return;
      const from = Math.max(0, Math.floor(range.from));
      const to = Math.min(data.length - 1, Math.ceil(range.to));
      const start = data[from];
      const end = data[to];
      if (start && end) {
        useWorkbench.getState().setViewport({ startTime: start.timestamp, endTime: end.timestamp });
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

  // —— 标的 / 周期变化时触发 DataLoader 重新拉取 ——
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    setMarketSnapshot(null);
    chart.setSymbol({ ticker: symbol, pricePrecision: 2, volumePrecision: 0 });
    chart.setPeriod(toChartPeriod(period));
  }, [symbol, period]);

  // —— 时间跨度或复权变化：在同一标的上重载数据（跳过首次挂载，避免与 setSymbol 双拉） ——
  const spanReady = useRef(false);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (!spanReady.current) {
      spanReady.current = true;
      return;
    }
    chart.resetData();
  }, [timeSpan, adjust]);

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
    if (!activeTool) return;

    chart.createOverlay({
      name: activeTool,
      groupId: USER_GROUP_ID,
      onDrawEnd: (event) => {
        const overlay = event.overlay as Overlay;
        const annotation = overlayToAnnotation(overlay);
        if (annotation) {
          void registerUserAnnotation(annotation).catch((err: unknown) => {
            notify(err instanceof Error ? err.message : "保存手绘标注失败", "error");
          });
        }
        setActiveTool(null);
        return true;
      },
    });
  }, [activeTool, registerUserAnnotation, setActiveTool, notify]);

  // —— 语义标注渲染 ——
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const visibleIds = new Set(annotationGroups.filter((g) => g.visible).map((g) => g.groupId));
    const visible: StoredAnnotation[] = annotations.filter((a) => visibleIds.has(a.groupId));

    // 清掉所有已知标注 id，再按可见性重绘（手绘临时 overlay 不在 annotations 里的保留）
    for (const a of annotations) {
      chart.removeOverlay({ id: a.id });
    }
    renderAnnotations(chart, visible);
  }, [annotations, annotationGroups]);

  // —— Agent 请求聚焦某段区间 ——
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !focusRequest) return;
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
  }, [focusRequest, consumeFocus]);

  // —— 框选模式 ——
  const onSelectStart = (e: React.MouseEvent) => {
    if (!selectionMode || !containerRef.current) return;
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
    notify("已框选区间，可在对话中提问");
    useWorkbench.getState().toggleSelectionMode();
  };

  return (
    <main className="glass-panel chart-panel flex min-w-0 flex-1 flex-col overflow-hidden rounded-[20px]">
      <div className="panel-header flex min-h-[67px] items-center justify-between gap-4 border-b border-line-soft px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="market-mark" aria-hidden="true">
            <Activity size={15} />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2.5">
              <h1 className="truncate font-mono text-[18px] font-semibold tracking-[-0.03em] text-ink">{symbol}</h1>
              <span className="truncate text-[12px] text-ink-dim">{instrumentName ?? ""}</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-ink-faint">
              <span className="market-status-dot" />
              <span>{PERIOD_LABELS[period]}</span>
              <span className="text-line">/</span>
              <span>{ADJUST_LABELS[adjust]}</span>
              <span className="text-line">/</span>
              <span>{TIME_SPANS.find((span) => span.id === timeSpan)?.label ?? timeSpan}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {marketSnapshot && (
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
          {selectionMode && (
            <span className="rounded-[8px] border border-accent/30 bg-accent-soft px-2.5 py-1 text-[11px] text-accent">
              框选模式：拖拽矩形选区
            </span>
          )}
          <button
            type="button"
            title="用当前标的运行匿名 Wyckoff AI 计划回测"
            className="glass-icon-btn inline-flex items-center gap-1.5 rounded-[11px] border border-line bg-panel-2 px-2.5 py-1.5 text-[11px] text-ink-dim transition-colors hover:border-accent/30 hover:text-ink"
            onClick={() => setBacktestOpen(true)}
          >
            <ChartNoAxesCombined size={13} />
            AI 计划回测
          </button>
          <WatchStarButton />
        </div>
      </div>

      <ChartToolbar />

      <div className="chart-surface relative min-h-0 flex-1">
        <div className="chart-reflection pointer-events-none absolute inset-0 z-[1]" />
        <div ref={containerRef} className="absolute inset-0" />

        {selectionMode && (
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

        {error && (
          <div className="absolute inset-x-0 top-4 z-20 flex justify-center">
            <div className="glass-panel-strong rounded-[10px] px-3 py-2 text-xs text-up">{error}</div>
          </div>
        )}
      </div>
    </main>
  );
}

function WatchStarButton() {
  const symbol = useWorkbench((s) => s.symbol);
  const watched = useWorkbench((s) => s.watchItems.some((item) => item.symbol === symbol));
  const activeWatchGroupId = useWorkbench((s) => s.activeWatchGroupId);
  const watchGroups = useWorkbench((s) => s.watchGroups);
  const toggleWatch = useWorkbench((s) => s.toggleWatch);
  const groupName = watchGroups.find((g) => g.id === activeWatchGroupId)?.name ?? "自选";

  return (
    <button
      type="button"
      title={watched ? "取消收藏" : `加入「${groupName}」`}
      className={cn(
        "glass-icon-btn inline-flex items-center gap-1.5 rounded-[11px] border px-2.5 py-1.5 text-[11px] transition-colors",
        watched
          ? "border-warn/35 bg-warn/10 text-warn"
          : "border-line bg-panel-2 text-ink-dim hover:border-warn/30 hover:text-warn",
      )}
      onClick={() => void toggleWatch({ symbol })}
    >
      <Star size={13} fill={watched ? "currentColor" : "none"} />
      {watched ? "已收藏" : "收藏"}
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
