import { type AnnotationGroup, makeId, type StoredAnnotation, type WyckoffAnnotation } from "@wyckoff/shared";
import { db } from "../db/index.js";

const insertGroup = db.prepare(`
  INSERT INTO annotation_groups (group_id, symbol, period, title, visible, created_at)
  VALUES (?, ?, ?, ?, 1, ?)
  ON CONFLICT(group_id) DO UPDATE SET title = excluded.title
`);

const insertAnnotation = db.prepare(`
  INSERT INTO annotations (id, group_id, symbol, period, source, payload)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
`);

export interface SaveGroupParams {
  groupId: string;
  symbol: string;
  period: string;
  title: string;
  annotations: WyckoffAnnotation[];
  source?: "agent" | "user";
}

/** 保存一整组标注，并回填 id / groupId，让前端拿到的就是最终形态。 */
export const saveAnnotationGroup = db.transaction((params: SaveGroupParams): StoredAnnotation[] => {
  const { groupId, symbol, period, title, annotations, source = "agent" } = params;
  insertGroup.run(groupId, symbol, period, title, Date.now());

  return annotations.map((annotation) => {
    const id = annotation.id ?? makeId(annotation.kind);
    const stored = { ...annotation, id, groupId, source } as StoredAnnotation;
    insertAnnotation.run(id, groupId, symbol, period, source, JSON.stringify(stored));
    return stored;
  });
});

export interface AnnotationBundle {
  groups: AnnotationGroup[];
  annotations: StoredAnnotation[];
}

export function listAnnotations(symbol: string, period: string): AnnotationBundle {
  const groups = db
    .prepare<[string, string], { group_id: string; symbol: string; period: string; title: string; visible: number; created_at: number }>(
      "SELECT group_id, symbol, period, title, visible, created_at FROM annotation_groups WHERE symbol = ? AND period = ? ORDER BY created_at",
    )
    .all(symbol, period)
    .map((g) => ({
      groupId: g.group_id,
      symbol: g.symbol,
      period: g.period,
      title: g.title,
      createdAt: g.created_at,
      visible: g.visible === 1,
    }));

  const annotations = db
    .prepare<[string, string], { payload: string }>(
      "SELECT payload FROM annotations WHERE symbol = ? AND period = ? ORDER BY rowid",
    )
    .all(symbol, period)
    .map((row) => JSON.parse(row.payload) as StoredAnnotation);

  return { groups, annotations };
}

export function deleteAnnotationGroup(groupId: string): void {
  db.prepare("DELETE FROM annotation_groups WHERE group_id = ?").run(groupId);
}

/** 清空某个标的下的全部标注，可按来源过滤（只清 Agent 画的、保留手绘的）。 */
export function clearAnnotations(symbol: string, period: string, source?: "agent" | "user"): number {
  const ids = db
    .prepare<(string | undefined)[], { group_id: string }>(
      `SELECT DISTINCT group_id FROM annotations WHERE symbol = ? AND period = ?${source ? " AND source = ?" : ""}`,
    )
    .all(...(source ? [symbol, period, source] : [symbol, period]))
    .map((r) => r.group_id);

  const stmt = db.prepare("DELETE FROM annotation_groups WHERE group_id = ?");
  for (const id of ids) stmt.run(id);
  return ids.length;
}

export function deleteAnnotation(id: string): void {
  db.prepare("DELETE FROM annotations WHERE id = ?").run(id);
}

export function updateAnnotation(id: string, patch: Record<string, unknown>): StoredAnnotation | null {
  const row = db.prepare<[string], { payload: string }>("SELECT payload FROM annotations WHERE id = ?").get(id);
  if (!row) return null;
  const merged = { ...(JSON.parse(row.payload) as StoredAnnotation), ...patch, id } as StoredAnnotation;
  db.prepare("UPDATE annotations SET payload = ? WHERE id = ?").run(JSON.stringify(merged), id);
  return merged;
}

export function setGroupVisible(groupId: string, visible: boolean): void {
  db.prepare("UPDATE annotation_groups SET visible = ? WHERE group_id = ?").run(visible ? 1 : 0, groupId);
}
