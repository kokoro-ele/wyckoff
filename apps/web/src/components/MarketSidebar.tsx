import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, BarChart3, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import type { MarketOverviewResponse, MarketOverviewRow } from "@wyckoff/shared";
import * as api from "@/lib/api.js";
import { useWorkbench } from "@/store.js";
import { cn, localizedInstrumentName } from "@/lib/utils.js";
import { useI18n } from "@/i18n.js";

const REGIONS = ["US", "CN"] as const;
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

function MarketRow({ row, onPick }: { row: MarketOverviewRow; onPick: (row: MarketOverviewRow) => void }) {
  const { t, lang } = useI18n();
  const name = localizedInstrumentName(row.name, lang, row.symbol, row.nameEn);
  const up = (row.changePct ?? 0) >= 0;
  return (
    <button type="button" className="market-row" onClick={() => onPick(row)}>
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
        {row.turnoverRate !== null && row.turnoverRate > 0 && <span>{t("market.turnover", { n: row.turnoverRate.toFixed(2) })}</span>}
      </div>
    </button>
  );
}

function MarketGroup({
  id,
  title,
  rows,
  open,
  onToggle,
  onPick,
}: {
  id: string;
  title: string;
  rows: MarketOverviewRow[];
  open: boolean;
  onToggle: (id: string) => void;
  onPick: (row: MarketOverviewRow) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="market-sector-group">
      <button type="button" className="market-group-head" onClick={() => onToggle(id)} aria-expanded={open}>
        <span>{title}</span>
        <span className="market-group-count">{rows.length}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && rows.map((row) => <MarketRow key={row.symbol} row={row} onPick={onPick} />)}
    </section>
  );
}

export function MarketSidebar({ onSelect }: { onSelect?: () => void }) {
  const { t, lang } = useI18n();
  const setSymbol = useWorkbench((s) => s.setSymbol);
  const [data, setData] = useState<MarketOverviewResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [region, setRegion] = useState<Region>("US");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const load = () => {
    setLoading(true);
    setError("");
    void api.fetchMarketOverview()
      .then(setData)
      .catch((cause) => setError(cause instanceof Error ? cause.message : t("market.error")))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);
  const rows = (data?.rows ?? []).filter((row) => row.region === region);
  const indices = (data?.indices ?? []).filter((row) => row.region === region);
  const volumeLeaders = [...rows].sort((a, b) => b.volume - a.volume).slice(0, 5);
  const turnoverLeaders = [...rows]
    .filter((row) => row.turnoverRate !== null && row.turnoverRate > 0)
    .sort((a, b) => (b.turnoverRate ?? 0) - (a.turnoverRate ?? 0))
    .slice(0, 5);
  const sectors = rows.reduce<Map<string, MarketOverviewRow[]>>((map, row) => {
    map.set(row.sector, [...(map.get(row.sector) ?? []), row]);
    return map;
  }, new Map());

  const pick = (row: MarketOverviewRow) => {
    void setSymbol(row.symbol, row.name, row.nameEn);
    onSelect?.();
  };
  const toggle = (id: string) => setCollapsed((current) => ({ ...current, [id]: !current[id] }));
  const open = (id: string) => !collapsed[id];

  return (
    <aside className="glass-panel side-panel flex h-full w-[226px] shrink-0 flex-col overflow-hidden rounded-[20px]">
      <div className="panel-header flex items-center justify-between border-b-2 border-line-soft px-3.5 py-3">
        <div>
          <div className="hand-eyebrow">MARKET · BOARDS</div>
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
        {!loading && rows.length === 0 && indices.length === 0 && !error && <p className="px-2 py-6 text-center text-[11px] text-ink-faint">{t("market.empty")}</p>}
        <MarketGroup id="indices" title={t("market.indices")} rows={indices} open={open("indices")} onToggle={toggle} onPick={pick} />
        <MarketGroup id="volume" title={t("market.volumeLeaders")} rows={volumeLeaders} open={open("volume")} onToggle={toggle} onPick={pick} />
        <MarketGroup id="turnover" title={t("market.turnoverLeaders")} rows={turnoverLeaders} open={open("turnover")} onToggle={toggle} onPick={pick} />
        {Array.from(sectors.entries()).map(([sector, sectorRows]) => (
          <MarketGroup
            key={sector}
            id={`sector-${sector}`}
            title={t(`market.sector.${sector}`) === `market.sector.${sector}` ? sector : t(`market.sector.${sector}`)}
            rows={sectorRows}
            open={open(`sector-${sector}`)}
            onToggle={toggle}
            onPick={pick}
          />
        ))}
      </div>
      {data && <div className="market-footnote shrink-0">{t("market.asOf", { time: new Date(data.updatedAt).toLocaleTimeString(lang === "zh" ? "zh-CN" : "en-US", { hour: "2-digit", minute: "2-digit" }) })}</div>}
    </aside>
  );
}
