import type { WatchGroup, WatchItem } from "@wyckoff/shared";
import { db } from "../db/index.js";

export function listGroups(): WatchGroup[] {
  return db
    .prepare<[], { id: number; name: string; sort: number; managed: number }>(
      "SELECT id, name, sort, managed_key IS NOT NULL AS managed FROM watch_groups ORDER BY sort, id",
    )
    .all()
    .map((group) => ({ ...group, managed: group.managed === 1 }));
}

export function createGroup(name: string): WatchGroup {
  const next = db.prepare<[], { m: number | null }>("SELECT MAX(sort) AS m FROM watch_groups").get();
  const sort = (next?.m ?? -1) + 1;
  const info = db.prepare("INSERT INTO watch_groups (name, sort) VALUES (?, ?)").run(name, sort);
  return { id: Number(info.lastInsertRowid), name, sort, managed: false };
}

export function findGroupByName(name: string): WatchGroup | undefined {
  return listGroups().find((group) => group.name === name);
}

export function ensureGroup(name: string): WatchGroup {
  return findGroupByName(name) ?? createGroup(name);
}

/** 系统分组以稳定 key 标识；首次升级时接管同名旧分组，避免复制出第二份。 */
export function ensureManagedGroup(key: string, name: string): WatchGroup {
  const existing = db
    .prepare<[string], { id: number }>("SELECT id FROM watch_groups WHERE managed_key = ?")
    .get(key);
  if (existing) {
    db.prepare("UPDATE watch_groups SET name = ? WHERE id = ?").run(name, existing.id);
    return listGroups().find((group) => group.id === existing.id)!;
  }

  const legacy = db.prepare<[string], { id: number }>("SELECT id FROM watch_groups WHERE name = ? ORDER BY id LIMIT 1").get(name);
  if (legacy) {
    const expectedBucket = key === "recommend_enter" ? "enter" : "watch";
    const unexpected = db
      .prepare<[string, number], { n: number }>(`
        SELECT COUNT(*) AS n
        FROM watch_items w
        LEFT JOIN recommend_book r ON r.symbol = w.symbol AND r.bucket = ?
        WHERE w.group_id = ? AND r.symbol IS NULL
      `)
      .get(expectedBucket, legacy.id);
    if ((unexpected?.n ?? 0) === 0) {
      db.prepare("UPDATE watch_groups SET managed_key = ? WHERE id = ?").run(key, legacy.id);
      return listGroups().find((group) => group.id === legacy.id)!;
    }
  }

  const next = db.prepare<[], { m: number | null }>("SELECT MAX(sort) AS m FROM watch_groups").get();
  const info = db.prepare("INSERT INTO watch_groups (name, sort, managed_key) VALUES (?, ?, ?)").run(
    name,
    (next?.m ?? -1) + 1,
    key,
  );
  return { id: Number(info.lastInsertRowid), name, sort: (next?.m ?? -1) + 1, managed: true };
}

export function isManagedGroup(id: number): boolean {
  const row = db.prepare<[number], { managed: number }>("SELECT managed_key IS NOT NULL AS managed FROM watch_groups WHERE id = ?").get(id);
  return row?.managed === 1;
}

export function listItemsInGroup(groupId: number): WatchItem[] {
  return listItems().filter((item) => item.groupId === groupId);
}

export function renameGroup(id: number, name: string): void {
  db.prepare("UPDATE watch_groups SET name = ? WHERE id = ?").run(name, id);
}

export function deleteGroup(id: number): void {
  // 至少保留一个分组，否则前端会没有可落脚的地方。
  const total = db.prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM watch_groups").get();
  if (!total || total.n <= 1) return;
  db.prepare("DELETE FROM watch_groups WHERE id = ?").run(id);
}

/** 关联标的表补齐名称，前端就不必再单独查一次。 */
export function listItems(): WatchItem[] {
  return db
    .prepare<[], WatchItem>(`
      SELECT w.symbol            AS symbol,
             i.name              AS name,
             COALESCE(i.exchange, '') AS exchange,
             i.type              AS type,
             w.group_id          AS groupId,
             w.sort              AS sort
      FROM watch_items w
      LEFT JOIN instruments i ON i.symbol = w.symbol
      ORDER BY w.group_id, w.sort, w.added_at
    `)
    .all();
}

export function addItem(symbol: string, groupId: number): void {
  const next = db
    .prepare<[number], { m: number | null }>("SELECT MAX(sort) AS m FROM watch_items WHERE group_id = ?")
    .get(groupId);
  db.prepare(
    "INSERT INTO watch_items (symbol, group_id, sort, added_at) VALUES (?, ?, ?, ?) ON CONFLICT(symbol, group_id) DO NOTHING",
  ).run(symbol, groupId, (next?.m ?? -1) + 1, Date.now());
}

export function removeItem(symbol: string, groupId: number): void {
  db.prepare("DELETE FROM watch_items WHERE symbol = ? AND group_id = ?").run(symbol, groupId);
}

export const reorderItems = db.transaction((groupId: number, symbols: string[]) => {
  const stmt = db.prepare("UPDATE watch_items SET sort = ? WHERE symbol = ? AND group_id = ?");
  symbols.forEach((symbol, i) => stmt.run(i, symbol, groupId));
});

export function isWatched(symbol: string): boolean {
  const row = db.prepare<[string], { n: number }>("SELECT COUNT(*) AS n FROM watch_items WHERE symbol = ?").get(symbol);
  return (row?.n ?? 0) > 0;
}
