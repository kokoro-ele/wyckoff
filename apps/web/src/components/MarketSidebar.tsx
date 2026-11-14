import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, BarChart3, RefreshCw } from "lucide-react";
import type { MarketOverviewResponse, MarketOverviewRow } from "@wyckoff/shared";
import * as api from "@/lib/api.js";
import { useWorkbench } from "@/store.js";
import { cn, localizedInstrumentName } from "@/lib/utils.js";
import { useI18n } from "@/i18n.js";

const REGIONS = ["all", "US", "CN", "HK"] as const;
type Region = (typeof REGIONS)[number];

function compactVolume(value: number, lang: "zh" | "en"): string {
  if (!Number.isFinite(value)) return "—";
  if (lang === "zh") {
    if (value >= 1e8) return `${(value / 1e8).toFixed(1)}亿`;
    if (value >= 1e4) return `${(value / 1e4).toFixed(0)}万`;
  } else {
    if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  }
  return Math.round(value).toLocaleString();
}

export function MarketSidebar({ onSelect }: { onSelect?: () => void }) {
  const { t, lang } = useI18n();
  const setSymbol = useWorkbench((s) => s.setSymbol);
  const [data, setData] = useState<MarketOverviewResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [region, setRegion] = useState<Region>("all");

  const load = () => {
    setLoading(true);
    setError("");
    void api.fetchMarketOverview()
      .then(setData)
      .catch((cause) => setError(cause instanceof Error ? cause.message : t("market.error")))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);
  const rows = (data?.rows ?? []).filter((row) => region === "all" || row.region === region);

  const pick = (row: MarketOverviewRow) => {
    void setSymbol(row.symbol, row.name, row.nameEn);
    onSelect?.();
  };

  return (
    <aside className="glass-panel side-panel flex h-full w-[226px] shrink-0 flex-col overflow-hidden rounded-[20px]">
      <div className="panel-header flex items-center justify-between border-b-2 border-line-soft px-3.5 py-3">
        <div>
          <div className="hand-eyebrow">MARKET · OVERVIEW</div>
          <div className="mt-0.5 text-[15px] font-semibold tracking-wide text-ink">{t("market.title")}</div>
          <div className="mt-0.5 text-[10px] text-ink-faint">{t("market.subtitle")}</div>
        </div>
        <button type="button" className="hand-icon" aria-label={t("action.refresh")} title={t("action.refresh")} onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="market-region-tabs shrink-0">
        {REGIONS.map((value) => (
          <button key={value} type="button" className={cn("market-region-tab", region === value && "is-active")} onClick={() => setRegion(value)}>
            {t(`market.region.${value}`)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {error && <p className="px-2 py-3 text-[11px] text-warn">{error}</p>}
        {loading && !data && <p className="px-2 py-6 text-center text-[11px] text-ink-faint">{t("market.loading")}</p>}
        {!loading && rows.length === 0 && !error && <p className="px-2 py-6 text-center text-[11px] text-ink-faint">{t("market.empty")}</p>}
        {rows.map((row) => {
          const name = localizedInstrumentName(row.name, lang, row.symbol, row.nameEn);
          const up = (row.changePct ?? 0) >= 0;
          return (
            <button type="button" key={row.symbol} className="market-row" onClick={() => pick(row)}>
              <div className="market-row-head">
                <span className="market-row-symbol">{row.symbol.split(".")[0]}</span>
                <span className={cn("market-row-change", up ? "text-up" : "text-down")}>
                  {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                  {row.changePct === null ? "—" : `${up ? "+" : ""}${row.changePct.toFixed(2)}%`}
                </span>
              </div>
              <div className="market-row-name">{name}</div>
              <div className="market-row-meta">
                <span className="market-row-price">{row.price.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 2 })}</span>
                <span><BarChart3 size={10} /> {compactVolume(row.volume, lang)}</span>
                {row.volumeRatio !== null && <span>{t("market.volumeRatio", { n: row.volumeRatio.toFixed(2) })}</span>}
              </div>
            </button>
          );
        })}
      </div>
      {data && <div className="market-footnote shrink-0">{t("market.asOf", { time: new Date(data.updatedAt).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit" }) })}</div>}
    </aside>
  );
}
