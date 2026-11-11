import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { initializeDatabase } from "../db/schema.js";
import { workspaceContext, type WorkspaceContext } from "./context.js";

let publicDatabase: Database.Database | undefined;

/**
 * Anonymous market data uses a process-local SQLite cache. It contains only
 * instruments and klines, never user watchlists, sessions, annotations or
 * credits. On Vercel it lives under /tmp and is disposable per instance.
 */
function database(): Database.Database {
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
    database: database(),
    dirty: false,
    deferred: [],
    state: new Map(),
    deadline: Date.now() + 60_000,
  };
  return workspaceContext.run(context, work);
}
