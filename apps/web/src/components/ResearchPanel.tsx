import { useEffect, useState } from "react";
import { Crosshair, Landmark, Minus, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import type { AdjustType, Period, ResearchLevel, ResearchResponse } from "@wyckoff/shared";
import * as api from "@/lib/api.js";
import { useI18n } from "@/i18n.js";
import {
  cn,
  formatCompactCurrency,
  formatCompactNumber,
  formatPct,
  formatPrice,
  formatRatio,
} from "@/lib/utils.js";

type Metric = { key: string; value: string };

function trendIcon(value: "up" | "down" | "flat") {
  if (value === "up") return <TrendingUp size={11} />;
  if (value === "down") return <TrendingDown size={11} />;
  return <Minus size={11} />;
}

function sourceLabel(source: string, t: (key: string) => string): string {
  return source
    .split(" · ")
    .map((part) => {
      if (part.includes("Tencent")) return t("research.source.tencent");
      if (part.includes("SEC")) return t("research.source.sec");
      if (part.includes("TickFlow")) return t("research.source.tickflow");
      return part;
    })
    .join(" · ");
}

function LevelGroup({ title, levels }: { title: string; levels: ResearchLevel[] }) {
  const { t } = useI18n();
  if (!levels.length) return null;
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-faint">{title}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {levels.map((level, index) => (
          <span key={`${level.kind}-${level.price}-${index}`} className="research-level">
            <span className="font-mono">{formatPrice(level.price)}</span>
            <span className="text-[9px] text-ink-faint">
              {level.kind === "range" ? t("research.levels.range") : t("research.levels.swing")}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function ResearchPanel({
  symbol,
  period,
  adjust,
}: {
  symbol: string;
  period: Period;
  adjust: AdjustType;
}) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<ResearchResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void api
      .fetchResearch({ symbol, period, adjust })
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : t("research.error"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, period, adjust, reload, t]);

  if (loading && !data) {
    return (
      <div className="research-panel flex-1 overflow-y-auto p-3">
        <div className="hand-empty p-4 text-center text-xs text-ink-dim">{t("research.loading")}</div>
        <div className="mt-3 h-28 animate-pulse rounded-xl bg-panel-2" />
        <div className="mt-3 h-40 animate-pulse rounded-xl bg-panel-2" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="research-panel flex-1 overflow-y-auto p-3">
        <div className="hand-empty p-4 text-center">
          <p className="text-xs text-warn">{t("research.error")}</p>
          <p className="mt-1 text-[11px] text-ink-faint">{error}</p>
          <button type="button" className="hand-btn mt-3 px-3 py-1.5 text-xs" onClick={() => setReload((value) => value + 1)}>
            {t("research.retry")}
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;
  const f = data.fundamentals;
  const strategy = data.strategy;
  const currency = f.currency ?? data.currency;
  const companyName =
    lang === "en"
      ? f.companyName ?? (!/[\u3400-\u9fff]/.test(data.name ?? "") ? data.name : null)
      : data.name;
  const change = data.quote.changePct;
  const metrics: Metric[] = [
    { key: "marketCap", value: formatCompactCurrency(f.marketCap, currency, lang) },
    { key: "pe", value: formatRatio(f.pe) },
    { key: "pb", value: formatRatio(f.pb) },
    { key: "eps", value: f.eps === null ? "—" : formatPrice(f.eps) },
    {
      key: "week52",
      value:
        f.week52High !== null && f.week52Low !== null
          ? `${formatPrice(f.week52Low)}–${formatPrice(f.week52High)}`
          : "—",
    },
    { key: "dividend", value: formatPct(f.dividendYieldPct) },
    { key: "revenue", value: formatCompactCurrency(f.revenue, currency, lang) },
    { key: "netIncome", value: formatCompactCurrency(f.netIncome, currency, lang) },
    { key: "grossMargin", value: formatPct(f.grossMarginPct) },
    { key: "netMargin", value: formatPct(f.netMarginPct) },
    { key: "roe", value: formatPct(f.roePct) },
    { key: "fiscalYear", value: f.fiscalYear ?? "—" },
  ];
  const visibleMetrics = metrics.filter((metric) => metric.value !== "—");
  const triggerPrice = strategy.trigger.price !== null ? formatPrice(strategy.trigger.price) : "—";
  const invalidationPrice = strategy.invalidation.price !== null ? formatPrice(strategy.invalidation.price) : "—";
  const source = sourceLabel(f.source, t);
  const updated = new Date(data.generatedAt).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="research-panel min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div className="research-quote">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[13px] font-semibold">{data.symbol}</span>
            <span className="truncate text-[11px] text-ink-dim">{companyName ?? ""}</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-[24px] font-semibold tabular-nums">{formatPrice(data.quote.price)}</span>
            {change !== null && (
              <span className={cn("font-mono text-[11px]", change >= 0 ? "text-up" : "text-down")}>
                {change >= 0 ? "+" : ""}{change.toFixed(2)}%
              </span>
            )}
            <span className="text-[9px] uppercase tracking-[0.12em] text-ink-faint">{currency}</span>
          </div>
        </div>
        <button type="button" className="hand-icon shrink-0" aria-label={t("research.refresh")} title={t("research.refresh")} onClick={() => setReload((value) => value + 1)}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <section className="research-card hand-card mt-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Landmark size={14} className="text-accent" />
            <h3 className="text-[13px] font-semibold">{t("research.fundamentals")}</h3>
          </div>
          {f.fiscalYear && <span className="text-[9px] text-ink-faint">FY {f.fiscalYear}</span>}
        </div>
        {visibleMetrics.length ? (
          <div className="research-metrics mt-2">
            {visibleMetrics.map((metric) => (
              <div key={metric.key} className="research-metric">
                <div className="text-[9px] text-ink-faint">{t(`research.metrics.${metric.key}`)}</div>
                <div className="mt-0.5 truncate font-mono text-[12px] text-ink">{metric.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-ink-faint">{t("research.noFundamentals")}</p>
        )}
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-dashed border-line-soft pt-2 text-[9px] text-ink-faint">
          <span className="truncate">{t("research.source")}: {source}</span>
          <span className="shrink-0">{t("research.updated", { time: updated })}</span>
        </div>
      </section>

      <section className="research-card hand-card mt-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Crosshair size={14} className="text-accent" />
            <h3 className="text-[13px] font-semibold">{t("research.strategy")}</h3>
          </div>
          <span className={cn("research-bias", strategy.bias === "long" ? "research-bias-long" : strategy.bias === "short" ? "research-bias-short" : "research-bias-wait")}>
            {t(`research.bias.${strategy.bias}`)}
          </span>
        </div>

        <div className="research-trend mt-2">
          {(["short", "medium", "long"] as const).map((term) => (
            <span key={term} className="research-trend-item">
              <span>{t(`research.trend.${term}`)}</span>
              <span className={cn("inline-flex items-center gap-0.5", strategy.trend[term] === "up" ? "text-up" : strategy.trend[term] === "down" ? "text-down" : "text-ink-faint")}>
                {trendIcon(strategy.trend[term])}
                {t(`research.trend.${strategy.trend[term]}`)}
              </span>
            </span>
          ))}
        </div>

        <div className="research-trigger mt-2">
          {t(`research.trigger.${strategy.trigger.kind}`, { price: triggerPrice })}
        </div>

        <div className="research-plan mt-2">
          <PlanRow label={t("research.entry")} value={strategy.entryLow !== null && strategy.entryHigh !== null ? `${formatPrice(strategy.entryLow)}–${formatPrice(strategy.entryHigh)}` : "—"} />
          <PlanRow label={t("research.stop")} value={formatPrice(strategy.stop)} />
          <PlanRow label={t("research.target1")} value={formatPrice(strategy.target1)} />
          <PlanRow label={t("research.target2")} value={formatPrice(strategy.target2)} />
          <PlanRow label={t("research.rr")} value={strategy.riskReward === null ? "—" : `${strategy.riskReward.toFixed(2)} : 1`} />
          <PlanRow label={t("research.invalidation")} value={t(`research.invalidation.${strategy.invalidation.kind}`, { price: invalidationPrice })} />
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2 border-t border-dashed border-line-soft pt-2">
          <LevelGroup title={t("research.support")} levels={strategy.support} />
          <LevelGroup title={t("research.resistance")} levels={strategy.resistance} />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] text-ink-faint">
          {strategy.range ? (
            <span>{t("research.range", { low: formatPrice(strategy.range.support), high: formatPrice(strategy.range.resistance) })}</span>
          ) : (
            <span>{t("research.noRange")}</span>
          )}
          <span>· {t("research.atr")} {formatCompactNumber(strategy.atr, lang)}</span>
        </div>
        <p className="mt-2 text-[9px] leading-relaxed text-ink-faint">{t("research.ruleNote")}<br />{t("research.disclaimer")}</p>
      </section>
    </div>
  );
}

function PlanRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="research-plan-row">
      <span>{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}
