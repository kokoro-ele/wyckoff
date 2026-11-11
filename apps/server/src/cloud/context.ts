import { AsyncLocalStorage } from "node:async_hooks";
import type Database from "better-sqlite3";

export interface WorkspaceContext {
  userId: string;
  transaction?: import("pg").PoolClient;
  finalizeUsage?: Array<() => Promise<void>>;
  database: Database.Database;
  /** Set by any scoped write so GET requests can skip needless snapshots. */
  dirty: boolean;
  deferred: Array<() => Promise<unknown>>;
  state: Map<string, unknown>;
  deadline: number;
}
export const workspaceContext = new AsyncLocalStorage<WorkspaceContext>();

export function deferWorkspaceJob(work: () => Promise<unknown>): void {
  const context = workspaceContext.getStore();
  if (context) context.deferred.push(work);
  else void work();
}

/** Marks the current workspace snapshot as changed before a direct write. */
export function markWorkspaceDirty(): void {
  const context = workspaceContext.getStore();
  if (context) context.dirty = true;
}
