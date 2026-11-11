import Database from "better-sqlite3";
import { config } from "../config.js";
import { workspaceContext } from "../cloud/context.js";
import { initializeDatabase } from "./schema.js";

let local: Database.Database | undefined;
function current(): Database.Database {
  const scoped = workspaceContext.getStore()?.database;
  if (scoped) return scoped;
  if (process.env.VERCEL || process.env.DATABASE_URL) throw new Error("Authenticated workspace context required");
  if (!local) {
    local = new Database(config.dbPath);
    initializeDatabase(local);
  }
  return local;
}

// Resolve at execution time so prepared statements never retain another user's DB.
export const db = {
  prepare<Bind extends unknown[] | object = unknown[], Result = unknown>(sql: string) {
    return {
      run(...args: Bind extends unknown[] ? Bind : [Bind]) {
        const context = workspaceContext.getStore();
        if (context) context.dirty = true;
        return current().prepare(sql).run(...args);
      },
      get(...args: Bind extends unknown[] ? Bind : [Bind]): Result | undefined {
        return current().prepare(sql).get(...args) as Result | undefined;
      },
      all(...args: Bind extends unknown[] ? Bind : [Bind]): Result[] {
        return current().prepare(sql).all(...args) as Result[];
      },
    };
  },
  transaction<Args extends unknown[], Result>(fn: (...args: Args) => Result) {
    return (...args: Args): Result => current().transaction(fn)(...args);
  },
  close() { local?.close(); local = undefined; },
};

export function getState(key: string): string | undefined {
  return db.prepare<[string], { value: string }>("SELECT value FROM app_state WHERE key = ?").get(key)?.value;
}
export function setState(key: string, value: string): void {
  db.prepare("INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
