import {
  Star,
  Trash2,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  Pencil,
  GripVertical,
  FolderPlus,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import type { WatchItem } from "@wyckoff/shared";
import { useWorkbench } from "@/store.js";
import { cn } from "@/lib/utils.js";

export function WatchlistSidebar() {
  const symbol = useWorkbench((s) => s.symbol);
  const groups = useWorkbench((s) => s.watchGroups);
  const items = useWorkbench((s) => s.watchItems);
  const activeWatchGroupId = useWorkbench((s) => s.activeWatchGroupId);
  const setSymbol = useWorkbench((s) => s.setSymbol);
  const setActiveWatchGroup = useWorkbench((s) => s.setActiveWatchGroup);
  const removeFromWatch = useWorkbench((s) => s.removeFromWatch);
  const moveWatchItem = useWorkbench((s) => s.moveWatchItem);
  const reorderWatchItems = useWorkbench((s) => s.reorderWatchItems);
  const addWatchGroup = useWorkbench((s) => s.addWatchGroup);
  const renameWatchGroup = useWorkbench((s) => s.renameWatchGroup);
  const removeWatchGroup = useWorkbench((s) => s.removeWatchGroup);
  const setSearchOpen = useWorkbench((s) => s.setSearchOpen);
  const displayGroups = useMemo(() => groups.filter(group => !group.managed), [groups]);

  const [adding, setAdding] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragSymbol, setDragSymbol] = useState<{ symbol: string; groupId: number } | null>(null);

  const itemsByGroup = useMemo(() => {
    const map = new Map<number, WatchItem[]>();
    for (const group of groups) map.set(group.id, []);
    for (const item of items) {
      const list = map.get(item.groupId);
      if (list) list.push(item);
      else map.set(item.groupId, [item]);
    }
    return map;
  }, [groups, items]);

  const total = items.filter(item => displayGroups.some(group => group.id === item.groupId)).length;

  return (
    <aside className="glass-panel side-panel flex h-full w-[226px] shrink-0 flex-col overflow-hidden rounded-[20px]">
      <div className="panel-header flex items-center justify-between border-b border-line-soft px-3.5 py-3">
        <div>
          <div className="eyebrow">MARKET DESK</div>
          <div className="mt-0.5 text-[14px] font-semibold tracking-wide text-ink">自选观察</div>
          <div className="mt-0.5 text-[10px] text-ink-faint">{total} 只标的 · 实时工作台</div>
        </div>
        <div className="flex items-center gap-0.5">
          <IconBtn title="搜索股票 ⌘K" onClick={() => setSearchOpen(true)}>
            <Search size={14} />
          </IconBtn>
          <IconBtn title="新建分组" onClick={() => setAdding(true)}>
            <FolderPlus size={14} />
          </IconBtn>
        </div>
      </div>

      {adding && (
        <form
          className="flex gap-1.5 border-b border-line-soft p-2.5 animate-rise"
          onSubmit={(e) => {
            e.preventDefault();
            const name = groupName.trim();
            if (!name) return;
            void addWatchGroup(name);
            setGroupName("");
            setAdding(false);
          }}
        >
          <input
            autoFocus
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="分组名称"
            className="glass-input min-w-0 flex-1 px-2.5 py-1.5 text-xs text-ink"
          />
          <button type="submit" className="glass-btn-primary rounded-[10px] px-2.5 text-xs">
            创建
          </button>
        </form>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {displayGroups.length === 0 && (
          <div className="px-3 py-10 text-center">
            <p className="text-xs text-ink-dim">还没有分组</p>
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-1 rounded-[10px] bg-accent-soft px-2.5 py-1.5 text-[11px] text-accent"
              onClick={() => setAdding(true)}
            >
              <Plus size={12} />
              新建分组
            </button>
          </div>
        )}

        {displayGroups.map((group) => {
          const groupItems = itemsByGroup.get(group.id) ?? [];
          const isCollapsed = collapsed[group.id] === true;
          const isTarget = !group.managed && activeWatchGroupId === group.id;
          const isRenaming = renamingId === group.id;

          return (
            <div key={group.id} className="mb-1.5">
              <div
                className={cn(
                  "watch-group-header group/header flex items-center gap-1 rounded-[11px] px-1.5 py-1.5",
                  isTarget && "bg-accent-soft/50",
                )}
              >
                <button
                  type="button"
                  className="rounded p-0.5 text-ink-faint hover:text-ink"
                  onClick={() => setCollapsed((c) => ({ ...c, [group.id]: !isCollapsed }))}
                >
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                </button>

                {isRenaming ? (
                  <form
                    className="min-w-0 flex-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const name = renameValue.trim();
                      if (name) void renameWatchGroup(group.id, name);
                      setRenamingId(null);
                    }}
                  >
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => {
                        const name = renameValue.trim();
                        if (name && name !== group.name) void renameWatchGroup(group.id, name);
                        setRenamingId(null);
                      }}
                      className="glass-input w-full px-2 py-0.5 text-[11px] text-ink"
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    title="点击设为默认收藏分组"
                    className="min-w-0 flex-1 truncate text-left text-[11px] font-medium text-ink-dim hover:text-ink"
                    onClick={() => {
                      if (!group.managed) setActiveWatchGroup(group.id);
                    }}
                  >
                    {group.name}
                    <span className="ml-1.5 text-ink-faint">{groupItems.length}</span>
                    {isTarget && <span className="ml-1.5 text-[10px] text-accent">默认</span>}

                  </button>
                )}

                {!group.managed && <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/header:opacity-100">
                  <IconBtn
                    title="重命名"
                    onClick={() => {
                      setRenamingId(group.id);
                      setRenameValue(group.name);
                    }}
                  >
                    <Pencil size={11} />
                  </IconBtn>
                  {groups.length > 1 && (
                    <IconBtn title="删除分组" onClick={() => void removeWatchGroup(group.id)}>
                      <Trash2 size={11} />
                    </IconBtn>
                  )}
                </div>}
              </div>

              {!isCollapsed && (
                <ul className="mt-0.5 space-y-0.5 px-0.5">
                  {groupItems.length === 0 ? (
                    <li className="px-3 py-2 text-[11px] text-ink-faint">
                      空分组 · 搜索后点星标加入
                    </li>
                  ) : (
                    groupItems.map((item, index) => {
                      const active = item.symbol === symbol;
                      return (
                        <li
                          key={`${group.id}-${item.symbol}`}
                          draggable={!group.managed}
                          onDragStart={() => setDragSymbol({ symbol: item.symbol, groupId: group.id })}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            if (!dragSymbol || group.managed) return;
                            if (dragSymbol.groupId === group.id) {
                              const symbols = groupItems.map((x) => x.symbol);
                              const from = symbols.indexOf(dragSymbol.symbol);
                              if (from < 0 || from === index) return;
                              symbols.splice(from, 1);
                              symbols.splice(index, 0, dragSymbol.symbol);
                              void reorderWatchItems(group.id, symbols);
                            } else {
                              void moveWatchItem(dragSymbol.symbol, dragSymbol.groupId, group.id);
                            }
                            setDragSymbol(null);
                          }}
                        >
                          <div
                            className={cn(
                              "watch-item group flex w-full items-center gap-1 rounded-[11px] px-1.5 py-1.5 transition-colors",
                              active ? "bg-accent-soft" : "hover:bg-panel-2",
                            )}
                          >
                            <GripVertical size={12} className="shrink-0 text-ink-faint/50" />
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left"
                              onClick={() => void setSymbol(item.symbol, item.name)}
                            >
                              <div
                                className={cn(
                                  "truncate font-mono text-[12px]",
                                  active ? "text-accent" : "text-ink",
                                )}
                              >
                                {item.symbol.split(".")[0]}
                              </div>
                              <div className="truncate text-[10px] text-ink-faint">
                                {item.name ?? item.symbol}

                              </div>
                            </button>

                            {!group.managed && groups.some((candidate) => !candidate.managed && candidate.id !== group.id) && (
                              <select
                                title="移动到其他分组"
                                className="max-w-[52px] appearance-none truncate rounded bg-transparent text-[10px] text-ink-faint opacity-0 group-hover:opacity-100"
                                value={group.id}
                                onChange={(e) => {
                                  const to = Number(e.target.value);
                                  if (to !== group.id) void moveWatchItem(item.symbol, group.id, to);
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {groups.filter((g) => !g.managed).map((g) => (
                                  <option key={g.id} value={g.id}>
                                    {g.name}
                                  </option>
                                ))}
                              </select>
                            )}

                            {!group.managed && <button
                              type="button"
                              title="移出本组"
                              className="shrink-0 rounded p-0.5 text-warn opacity-0 group-hover:opacity-100"
                              onClick={() => void removeFromWatch(item.symbol, group.id)}
                            >
                              <Star size={12} fill="currentColor" />
                            </button>}
                          </div>
                        </li>
                      );
                    })
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>

    </aside>
  );
}

function IconBtn({
  children,
  title,
  onClick,
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-panel-2 hover:text-ink"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
