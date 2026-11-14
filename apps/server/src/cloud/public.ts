import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { initializeDatabase } from "../db/schema.js";
import { workspaceContext, type WorkspaceContext } from "./context.js";

let publicDatabase: Database.Database | undefined;

/**
 * Market data uses a process-local shared SQLite cache. It contains only
 * instruments and klines, never user watchlists, sessions, annotations or
 * credits. Authenticated and anonymous requests share it so K-line history is
 * not copied into every private workspace. On Vercel it lives under /tmp and is
 * disposable per instance.
 */
export function publicCacheDatabase(): Database.Database {
  if (!publicDatabase) {
    const directory = path.join(config.dataDir, "public");
    mkdirSync(directory, { recursive: true });
    publicDatabase = new Database(path.join(directory, "public.db"));
    initializeDatabase(publicDatabase);
  }
  return publicDatabase;
}

export async function withPublicWorkspace<T>(work: () => Promise<T>): Promise<T> {
  const context: WorkspaceContext = {
    userId: "__public__",
    database: publicCacheDatabase(),
    dirty: false,
    deferred: [],
    state: new Map(),
    deadline: Date.now() + 60_000,
  };
  return workspaceContext.run(context, work);
}
