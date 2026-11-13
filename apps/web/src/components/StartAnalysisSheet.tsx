import { useEffect, useRef, useState } from "react";
import { ArrowRight, Search, Sparkles, X } from "lucide-react";
import type { Instrument } from "@wyckoff/shared";
import * as api from "@/lib/api.js";
import { useI18n } from "@/i18n.js";
import { localizedInstrumentName } from "@/lib/utils.js";

const POPULAR = [
  { symbol: "NVDA.US", name: "NVIDIA", nameEn: "NVIDIA" },
  { symbol: "AAPL.US", name: "Apple", nameEn: "Apple" },
  { symbol: "TSLA.US", name: "Tesla", nameEn: "Tesla" },
  { symbol: "600519.SH", name: "贵州茅台", nameEn: "Kweichow Moutai" },
  { symbol: "00700.HK", name: "腾讯控股", nameEn: "Tencent" },
] as const;

type Hit = Instrument & { score?: number };

export function StartAnalysisSheet({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (symbol: string, name?: string | null, nameEn?: string | null) => void;
}) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setLoading(false);
  }, [open]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!open || !query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(() => {
      void api
        .searchInstruments(query.trim(), 8)
        .then((res) => setResults(res.results))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 180);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [open, query]);

  if (!open) return null;

  const nameOf = (item: Pick<Hit, "symbol" | "name" | "nameEn">) =>
    localizedInstrumentName(item.name, lang, item.symbol, item.nameEn);

  return (
    <div className="mobile-modal-backdrop fixed inset-0 z-[55] flex items-center justify-center bg-ink/35 px-4 backdrop-blur-[3px]" onClick={onClose}>
      <section className="start-sheet hand-card w-full max-w-[480px] p-5" role="dialog" aria-modal="true" aria-labelledby="start-title" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="hand-eyebrow">START · WYCKOFF</div>
            <h2 id="start-title" className="mt-1 text-[24px] font-semibold leading-tight">
              {t("start.title")}
            </h2>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">{t("start.subtitle")}</p>
          </div>
          <button type="button" className="hand-icon" onClick={onClose} aria-label={t("action.close")}>
            <X size={17} />
          </button>
        </div>

        <div className="start-search mt-4 flex items-center gap-2">
          <Search size={16} className="shrink-0 text-ink-faint" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("start.search")}
            aria-label={t("start.search")}
          />
        </div>

        {query.trim() ? (
          <div className="start-results mt-2">
            {loading && <div className="start-empty">{t("search.loading")}</div>}
            {!loading && results.length === 0 && <div className="start-empty">{t("search.noResults")}</div>}
            {results.map((item) => (
              <button type="button" key={item.symbol} className="start-result" onClick={() => onPick(item.symbol, item.name, item.nameEn)}>
                <span className="min-w-0">
                  <strong>{nameOf(item)}</strong>
                  <small>{item.symbol}</small>
                </span>
                <ArrowRight size={14} />
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="start-label mt-4">{t("start.popular")}</div>
            <div className="start-popular">
              {POPULAR.map((item) => (
                <button type="button" key={item.symbol} className="start-popular-chip" onClick={() => onPick(item.symbol, item.name, item.nameEn)}>
                  <span>{nameOf(item)}</span>
                  <small>{item.symbol}</small>
                </button>
              ))}
            </div>
            <button type="button" className="start-primary hand-btn hand-btn-primary mt-5 w-full" onClick={() => onPick("NVDA.US", "NVIDIA", "NVIDIA")}>
              <Sparkles size={15} />
              {t("start.example")}
              <ArrowRight size={14} />
            </button>
          </>
        )}
      </section>
    </div>
  );
}
