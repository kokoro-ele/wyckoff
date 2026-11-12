import { useEffect, useState } from "react";
import { Crosshair, Landmark, LockKeyhole, RefreshCw, Sparkles } from "lucide-react";
import type { AdjustType, AgentTradePlan, Period, ResearchLevel, ResearchResponse } from "@wyckoff/shared";
import * as api from "@/lib/api.js";
import { useWorkbench } from "@/store.js";
import { useI18n } from "@/i18n.js";
import {
  cn,
  formatCompactCurrency,
  formatPct,
  formatPrice,
  formatRatio,
} from "@/lib/utils.js";

type Metric = { key: string; value: string };

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
  onRequestAnalysis,
}: {
  symbol: string;
  period: Period;
  adjust: AdjustType;
  onRequestAnalysis: () => void;
}) {
  const { t, lang } = useI18n();
  const messages = useWorkbench((s) => s.messages);
  const hasAnalysis = messages.some(
    (message) =>
      (message.mode ?? "agent") === "agent" &&
      message.role === "assistant" &&
      !message.streaming &&
      (message.content.trim().length > 0 || (message.toolTrace?.length ?? 0) > 0),
  );
  const [data, setData] = useState<ResearchResponse | null>(null);
  const [plan, setPlan] = useState<AgentTradePlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!hasAnalysis) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    setPlanLoading(true);
    void api
      .fetchTradePlan({ symbol, period, adjust })
      .then(({ plan: value }) => {
        if (!cancelled) setPlan(value);
      })
      .catch(() => {
        if (!cancelled) setPlan(null);
      })
      .finally(() => {
        if (!cancelled) setPlanLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasAnalysis, symbol, period, adjust]);

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

      {hasAnalysis ? (
        planLoading ? (
          <div className="mt-3 h-36 animate-pulse rounded-xl bg-panel-2" />
        ) : plan ? (
          <section className="research-card hand-card mt-3 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Crosshair size={14} className="text-accent" />
                <h3 className="text-[13px] font-semibold">{t("research.strategy")}</h3>
              </div>
              <span className={cn("research-bias", plan.bias === "long" ? "research-bias-long" : plan.bias === "short" ? "research-bias-short" : "research-bias-wait")}>
                {t(`research.bias.${plan.bias}`)}
              </span>
            </div>

            <div className="research-trigger mt-2">{plan.trigger}</div>

            <div className="research-plan mt-2">
              <PlanRow label={t("research.entry")} value={plan.entryLow !== null && plan.entryHigh !== null ? `${formatPrice(plan.entryLow)}–${formatPrice(plan.entryHigh)}` : "—"} />
              <PlanRow label={t("research.stop")} value={plan.stop === null ? "—" : formatPrice(plan.stop)} />
              <PlanRow label={t("research.target1")} value={plan.target1 === null ? "—" : formatPrice(plan.target1)} />
              <PlanRow label={t("research.target2")} value={plan.target2 === null ? "—" : formatPrice(plan.target2)} />
              <PlanRow label={t("research.rr")} value={plan.riskReward === null ? "—" : `${plan.riskReward.toFixed(2)} : 1`} />
              <PlanRow label={t("research.invalidation")} value={plan.invalidation} />
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 border-t border-dashed border-line-soft pt-2">
              <LevelGroup title={t("research.support")} levels={plan.support.map((price) => ({ price, kind: "swing" as const }))} />
              <LevelGroup title={t("research.resistance")} levels={plan.resistance.map((price) => ({ price, kind: "swing" as const }))} />
            </div>

            <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">{plan.note}</p>
            <p className="mt-2 text-[9px] leading-relaxed text-ink-faint">{t("research.ruleNote")}<br />{t("research.disclaimer")}</p>
          </section>
        ) : (
          <section className="research-card hand-card mt-3 p-3">
            <div className="flex items-center gap-1.5">
              <Sparkles size={14} className="text-accent" />
              <h3 className="text-[13px] font-semibold">{t("research.plan.missingTitle")}</h3>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">{t("research.plan.missingBody")}</p>
            <button type="button" className="hand-btn hand-btn-primary mt-3 inline-flex items-center gap-1.5 px-3 py-2 text-xs" onClick={onRequestAnalysis}>
              <Sparkles size={13} />
              {t("research.plan.missingCta")}
            </button>
          </section>
        )
      ) : (
        <section className="research-card hand-card mt-3 p-3">
          <div className="flex items-center gap-1.5">
            <LockKeyhole size={14} className="text-accent" />
            <h3 className="text-[13px] font-semibold">{t("research.lockedTitle")}</h3>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">{t("research.lockedBody")}</p>
          <button type="button" className="hand-btn hand-btn-primary mt-3 inline-flex items-center gap-1.5 px-3 py-2 text-xs" onClick={onRequestAnalysis}>
            <Crosshair size={13} />
            {t("research.lockedCta")}
          </button>
          <p className="mt-2 text-[9px] text-ink-faint">{t("research.lockedNote")}</p>
        </section>
      )}
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
