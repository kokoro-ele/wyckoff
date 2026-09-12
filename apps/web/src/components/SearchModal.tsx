import { Star, Search, X, Folder } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Instrument } from "@wyckoff/shared";
import * as api from "@/lib/api.js";
import { useWorkbench } from "@/store.js";
import { cn } from "@/lib/utils.js";

type SearchHit = Instrument & { score: number };

export function SearchModal() {
  const open = useWorkbench((s) => s.searchOpen);
  const setSearchOpen = useWorkbench((s) => s.setSearchOpen);
  const setSymbol = useWorkbench((s) => s.setSymbol);
  const toggleWatch = useWorkbench((s) => s.toggleWatch);
  const watchGroups = useWorkbench((s) => s.watchGroups);
  const activeWatchGroupId = useWorkbench((s) => s.activeWatchGroupId);
  const setActiveWatchGroup = useWorkbench((s) => s.setActiveWatchGroup);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [indexSize, setIndexSize] = useState(0);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "Escape" && open) setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setSearchOpen]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const runSearch = useCallback((q: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    timer.current = setTimeout(() => {
      void api
        .searchInstruments(q.trim(), 40)
        .then((res) => {
          setResults(res.results);
          setIndexSize(res.indexSize);
          setActive(0);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 180);
  }, []);

  if (!open) return null;

  const pick = (hit: SearchHit) => {
    void setSymbol(hit.symbol, hit.name);
    setSearchOpen(false);
  };

  const userGroups = watchGroups.filter((group) => !group.managed);
  const activeGroupName = userGroups.find((g) => g.id === activeWatchGroupId)?.name ?? "自选";

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 pt-[12vh] backdrop-blur-sm"
      onClick={() => setSearchOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="搜索股票"
        className="glass-panel-strong modal-glass flex w-full max-w-xl flex-col overflow-hidden rounded-[22px] animate-rise"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line-soft px-3.5">
          <Search size={16} className="text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              runSearch(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && results[active]) {
                pick(results[active]);
              }
            }}
            placeholder="代码 / 名称 / 拼音首字母，如 600519 或 pfyh"
            className="h-12 flex-1 text-sm text-ink placeholder:text-ink-faint"
          />
          <button type="button" className="rounded-lg p-1.5 text-ink-faint hover:bg-panel-2 hover:text-ink" onClick={() => setSearchOpen(false)}>
            <X size={16} />
          </button>
        </div>

        {userGroups.length > 0 && (
          <div className="flex items-center gap-2 border-b border-line-soft px-3.5 py-2">
            <Folder size={12} className="text-ink-faint" />
            <span className="text-[11px] text-ink-faint">星标加入</span>
            <div className="flex flex-wrap gap-1">
              {userGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setActiveWatchGroup(g.id)}
                  className={cn(
                    "glass-chip rounded-[8px] px-2 py-0.5 text-[11px]",
                    g.id === activeWatchGroupId && "glass-chip-active",
                  )}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="max-h-80 overflow-y-auto">
          {loading && <p className="px-4 py-6 text-center text-xs text-ink-faint">搜索中…</p>}
          {!loading && query && results.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-ink-faint">
              无匹配结果{indexSize === 0 ? "（标的索引仍在同步，请稍候）" : ""}
            </p>
          )}
          {!loading &&
            results.map((hit, i) => (
              <SearchRow
                key={hit.symbol}
                hit={hit}
                active={i === active}
                groupHint={activeGroupName}
                groupId={activeWatchGroupId}
                onPick={() => pick(hit)}
                onToggleWatch={() => void toggleWatch(hit, activeWatchGroupId ?? undefined)}
                onHover={() => setActive(i)}
              />
            ))}
          {!query && (
            <p className="px-4 py-8 text-center text-xs text-ink-faint">
              支持代码前缀、中文名称、拼音首字母（如 <span className="font-mono text-ink-dim">gzmt</span> → 贵州茅台）
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SearchRow({
  hit,
  active,
  groupHint,
  groupId,
  onPick,
  onToggleWatch,
  onHover,
}: {
  hit: SearchHit;
  active: boolean;
  groupHint: string;
  groupId: number | null;
  onPick: () => void;
  onToggleWatch: () => void;
  onHover: () => void;
}) {
  const watchedInGroup = useWorkbench((s) =>
    groupId == null
      ? s.watchItems.some((item) => item.symbol === hit.symbol)
      : s.watchItems.some((item) => item.symbol === hit.symbol && item.groupId === groupId),
  );
  return (
    <div
      className={cn(
        "flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors",
        active ? "bg-accent-soft/60" : "hover:bg-panel-2",
      )}
      onMouseEnter={onHover}
      onClick={onPick}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm text-ink">{hit.symbol}</span>
          <span className="truncate text-xs text-ink-dim">{hit.name ?? "—"}</span>
        </div>
        <div className="text-[11px] text-ink-faint">
          {hit.exchange} · {hit.type ?? "—"} · {hit.region}
        </div>
      </div>
      <button
        type="button"
        title={watchedInGroup ? `从「${groupHint}」移除` : `加入「${groupHint}」`}
        className={cn(
          "rounded-lg p-1.5 transition-colors",
          watchedInGroup ? "text-warn" : "text-ink-faint hover:bg-panel-2 hover:text-warn",
        )}
        onClick={(e) => {
          e.stopPropagation();
          onToggleWatch();
        }}
      >
        <Star size={14} fill={watchedInGroup ? "currentColor" : "none"} />
      </button>
    </div>
  );
}
