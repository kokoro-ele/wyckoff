import type Database from "better-sqlite3";

/**
 * Rebuildable market caches are never merged: they are large and a stale copy
 * is harmless because they are refetched on demand.
 */
const SKIPPED_TABLES = new Set(["klines", "kline_meta", "instruments"]);

type Row = Record<string, unknown>;
interface ColumnInfo {
  name: string;
  pk: number;
}

const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

function userTables(database: Database.Database): string[] {
  return (
    database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid")
      .all() as Array<{ name: string }>
  )
    .map((row) => row.name)
    .filter((name) => !SKIPPED_TABLES.has(name));
}

function columns(database: Database.Database, table: string): ColumnInfo[] {
  return database.prepare(`PRAGMA table_info(${quote(table)})`).all() as ColumnInfo[];
}

function rowsByKey(
  database: Database.Database,
  table: string,
  keyColumns: string[],
): Map<string, { row: Row; json: string }> {
  const result = new Map<string, { row: Row; json: string }>();
  for (const row of database.prepare(`SELECT * FROM ${quote(table)}`).all() as Row[]) {
    const key = JSON.stringify(keyColumns.map((column) => row[column]));
    result.set(key, { row, json: JSON.stringify(row) });
  }
  return result;
}

function isForeignKeyError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "SQLITE_CONSTRAINT_FOREIGNKEY";
}

/**
 * Three-way, row-level merge used when a long-running request (an analysis)
 * finishes after another request already committed a newer workspace version.
 *
 * `base` is the snapshot the long request started from, `changed` is that
 * snapshot after the request's own writes, and `target` is the latest committed
 * snapshot. Every row the request inserted, updated or deleted (compared by
 * primary key) is replayed onto `target`; rows it did not touch keep the
 * concurrent writer's version. When both sides changed the same row, the
 * request's version wins. A row whose parent was deleted concurrently is
 * dropped instead of resurrecting the parent.
 */
export function mergeWorkspaceChanges(
  base: Database.Database,
  changed: Database.Database,
  target: Database.Database,
): { upserted: number; deleted: number; skipped: number } {
  const baseTables = new Set(userTables(base));
  const targetTables = new Set(userTables(target));
  const tables = userTables(changed).filter((table) => targetTables.has(table));
  const stats = { upserted: 0, deleted: 0, skipped: 0 };
  const deletions: Array<() => void> = [];

  target.transaction(() => {
    for (const table of tables) {
      const changedColumns = columns(changed, table);
      const targetColumnNames = new Set(columns(target, table).map((column) => column.name));
      const usable = changedColumns.map((column) => column.name).filter((name) => targetColumnNames.has(name));
      const keyColumns = changedColumns
        .filter((column) => column.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((column) => column.name);
      if (usable.length === 0) continue;

      if (keyColumns.length === 0) {
        // No primary key to merge by: take the request's whole table if it changed it.
        const before = baseTables.has(table) ? rowsByKey(base, table, usable) : new Map();
        const after = rowsByKey(changed, table, usable);
        const same =
          before.size === after.size && [...after.keys()].every((key) => before.has(key));
        if (same) continue;
        target.prepare(`DELETE FROM ${quote(table)}`).run();
        const insert = target.prepare(
          `INSERT INTO ${quote(table)} (${usable.map(quote).join(",")}) VALUES (${usable.map(() => "?").join(",")})`,
        );
        for (const { row } of after.values()) insert.run(...usable.map((column) => row[column]));
        stats.upserted += after.size;
        continue;
      }

      const before = baseTables.has(table) ? rowsByKey(base, table, keyColumns) : new Map<string, { row: Row; json: string }>();
      const after = rowsByKey(changed, table, keyColumns);
      const valueColumns = usable.filter((column) => !keyColumns.includes(column));
      const conflict = valueColumns.length
        ? `DO UPDATE SET ${valueColumns.map((column) => `${quote(column)}=excluded.${quote(column)}`).join(",")}`
        : "DO NOTHING";
      const upsert = target.prepare(
        `INSERT INTO ${quote(table)} (${usable.map(quote).join(",")}) VALUES (${usable.map(() => "?").join(",")})
         ON CONFLICT(${keyColumns.map(quote).join(",")}) ${conflict}`,
      );
      for (const [key, entry] of after) {
        if (before.get(key)?.json === entry.json) continue;
        try {
          upsert.run(...usable.map((column) => entry.row[column]));
          stats.upserted++;
        } catch (error) {
          if (!isForeignKeyError(error)) throw error;
          stats.skipped++;
        }
      }

      const remove = target.prepare(
        `DELETE FROM ${quote(table)} WHERE ${keyColumns.map((column) => `${quote(column)} IS ?`).join(" AND ")}`,
      );
      for (const [key, entry] of before) {
        if (after.has(key)) continue;
        deletions.push(() => {
          stats.deleted += remove.run(...keyColumns.map((column) => entry.row[column])).changes;
        });
      }
    }
    // Children are created after parents, so delete in reverse table order.
    for (const remove of deletions.reverse()) remove();
  })();

  return stats;
}
