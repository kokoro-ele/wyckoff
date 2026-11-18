import Database from "better-sqlite3";
import { gzipSync, gunzipSync } from "node:zlib";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getPool } from "./postgres.js";
import { initializeDatabase } from "../db/schema.js";
import { workspaceContext, type WorkspaceContext } from "./context.js";
import { mergeWorkspaceChanges } from "./merge.js";

const MAX_WORKSPACE_BYTES = 64 * 1024 * 1024;
/** Start dropping re-fetchable caches before hitting the hard workspace cap. */
const COMPACT_AT_BYTES = 48 * 1024 * 1024;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 32;

export class WorkspaceTooLargeError extends Error {
  constructor() {
    super("工作区超过 64 MiB。请清理历史分析或稍后重试；行情缓存已自动清理但仍超出上限。");
    this.name = "WorkspaceTooLargeError";
  }
}

/**
 * Decrypted snapshots keyed by user + row version. This avoids repeated
 * AES/GCM + gunzip work for read-heavy sessions while preserving instance
 * isolation and the Postgres version check.
 */
const snapshotCache = new Map<string, Buffer>();
let snapshotCacheBytes = 0;

function cacheKey(userId: string, version: number): string {
  return `${userId}:${version}`;
}

function getCachedSnapshot(userId: string, version: number): Buffer | undefined {
  const key = cacheKey(userId, version);
  const value = snapshotCache.get(key);
  if (!value) return undefined;
  // Refresh insertion order for a small LRU.
  snapshotCache.delete(key);
  snapshotCache.set(key, value);
  return value;
}

/** Newest snapshot version this instance holds per user, so reads can skip the payload. */
const latestCachedVersion = new Map<string, number>();

function setCachedSnapshot(userId: string, version: number, serialized: Buffer): void {
  if (serialized.length > MAX_CACHE_BYTES) return;
  latestCachedVersion.set(userId, Math.max(latestCachedVersion.get(userId) ?? -1, version));
  const key = cacheKey(userId, version);
  const previous = snapshotCache.get(key);
  if (previous) {
    snapshotCacheBytes -= previous.length;
    snapshotCache.delete(key);
  }
  snapshotCache.set(key, serialized);
  snapshotCacheBytes += serialized.length;
  while (snapshotCacheBytes > MAX_CACHE_BYTES || snapshotCache.size > MAX_CACHE_ENTRIES) {
    const oldest = snapshotCache.keys().next().value as string | undefined;
    if (!oldest) break;
    const entry = snapshotCache.get(oldest);
    if (entry) snapshotCacheBytes -= entry.length;
    snapshotCache.delete(oldest);
  }
}

function encryptionKey(): Buffer {
  const key = process.env.WORKSPACE_ENCRYPTION_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key)) {
    throw new Error("WORKSPACE_ENCRYPTION_KEY must be 32 random bytes encoded as hex");
  }
  return Buffer.from(key, "hex");
}

export function encodeWorkspaceBuffer(serialized: Buffer, userId: string): Buffer {
  if (serialized.length > MAX_WORKSPACE_BYTES) throw new WorkspaceTooLargeError();
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  cipher.setAAD(Buffer.from(userId));
  const encrypted = Buffer.concat([cipher.update(gzipSync(serialized)), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
}

export function encodeWorkspace(database: Database.Database, userId: string): Buffer {
  return encodeWorkspaceBuffer(database.serialize(), userId);
}

export function decodeWorkspace(payload: Buffer, userId: string): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), payload.subarray(0, 12));
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(payload.subarray(12, 28));
  return gunzipSync(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]), {
    maxOutputLength: MAX_WORKSPACE_BYTES,
  });
}

/**
 * Drops caches that can be rebuilt from the market-data provider when a
 * workspace approaches the hard cap. User annotations, chats and watchlists
 * are never touched.
 */
function compactWorkspace(database: Database.Database): void {
  database.exec("DELETE FROM klines; DELETE FROM kline_meta; VACUUM;");
  if (database.serialize().length > COMPACT_AT_BYTES) {
    database.exec("DELETE FROM instruments; VACUUM;");
  }
}

interface WorkspaceRow {
  payload: Buffer | null;
  version: number;
}

/**
 * Reads the workspace row, transferring the encrypted payload only when this
 * instance does not already hold that exact version. Every API request goes
 * through here, so shipping the whole snapshot each time was the main source
 * of database egress.
 */
async function selectWorkspace(
  db: Pool | PoolClient,
  userId: string,
  lock: boolean,
  useCache = true,
): Promise<{ row: WorkspaceRow | undefined; serialized: Buffer | undefined }> {
  const known = useCache ? latestCachedVersion.get(userId) ?? -1 : -1;
  const { rows } = await db.query<WorkspaceRow & { has_payload: boolean }>(
    `SELECT version, CASE WHEN version = $2 THEN NULL ELSE payload END AS payload, payload IS NOT NULL AS has_payload
     FROM workspaces WHERE user_id = $1${lock ? " FOR UPDATE" : ""}`,
    [userId, known],
  );
  const row = rows[0];
  if (!row) return { row: undefined, serialized: undefined };
  const result = { version: row.version, payload: row.payload };
  if (!row.has_payload) return { row: result, serialized: undefined };
  if (row.payload) return { row: result, serialized: readSnapshot(userId, result) };
  const cached = getCachedSnapshot(userId, row.version);
  if (cached) return { row: result, serialized: cached };
  // The cached copy was evicted after the query: fetch this exact version.
  const full = await db.query<{ payload: Buffer | null }>(
    "SELECT payload FROM workspaces WHERE user_id = $1 AND version = $2",
    [userId, row.version],
  );
  if (!full.rows[0]) return selectWorkspace(db, userId, lock, false);
  const fetched = { version: row.version, payload: full.rows[0].payload };
  return { row: fetched, serialized: readSnapshot(userId, fetched) };
}

function readSnapshot(userId: string, row: WorkspaceRow | undefined): Buffer | undefined {
  if (!row?.payload) return undefined;
  const cached = getCachedSnapshot(userId, row.version);
  if (cached) return cached;
  let serialized: Buffer;
  try {
    serialized = decodeWorkspace(row.payload, userId);
  } catch (error) {
    if (error instanceof RangeError || (error as NodeJS.ErrnoException)?.code === "ERR_BUFFER_TOO_LARGE") {
      throw new WorkspaceTooLargeError();
    }
    throw error;
  }
  setCachedSnapshot(userId, row.version, serialized);
  return serialized;
}

/** Opens a snapshot and applies the idempotent upgrades every request performs. */
function openWorkspaceDatabase(serialized: Buffer | undefined): { database: Database.Database; dirty: boolean } {
  const database = new Database(serialized ?? ":memory:");
  try {
    const schemaChanged = initializeDatabase(database);

    // K-line history moved to the shared process cache. Remove legacy copies
    // from every user's encrypted snapshot once on first access; this is the
    // difference between a multi-megabyte workspace read on every API call and
    // a small user-data snapshot.
    let legacyCacheRemoved = false;
    const cacheVersion = database
      .prepare("SELECT value FROM app_state WHERE key = 'market-cache-version'")
      .get() as { value: string } | undefined;
    if (cacheVersion?.value !== "shared-v2") {
      try {
        database.exec(
          "DELETE FROM klines; DELETE FROM kline_meta; VACUUM; INSERT INTO app_state(key, value) VALUES('market-cache-version', 'shared-v2') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        );
        legacyCacheRemoved = true;
      } catch (error) {
        console.warn("[workspace] legacy market-cache cleanup failed:", (error as Error).message);
      }
    }

    const stale = database
      .prepare(
        "UPDATE ai_backtest_runs SET status = 'failed', error = '云端任务超过执行时限，请缩小回测范围后重试', updated_at = ? WHERE status IN ('queued', 'running') AND updated_at < ?",
      )
      .run(Date.now(), Date.now() - 300_000);

    return { database, dirty: Boolean(schemaChanged) || legacyCacheRemoved || stale.changes > 0 };
  } catch (error) {
    database.close();
    throw error;
  }
}

function serializeForStorage(database: Database.Database): Buffer {
  let snapshot = database.serialize();
  if (snapshot.length > COMPACT_AT_BYTES) {
    console.warn("[workspace] compacting oversized workspace cache");
    compactWorkspace(database);
    snapshot = database.serialize();
  }
  if (snapshot.length > MAX_WORKSPACE_BYTES) throw new WorkspaceTooLargeError();
  return snapshot;
}

/**
 * Credit usage is settled in its own short Postgres transactions, after the
 * workspace outcome is known: `committed=false` always refunds the reservation.
 */
async function settleUsage(context: WorkspaceContext, committed: boolean): Promise<void> {
  for (const finalize of context.finalizeUsage ?? []) {
    try {
      await finalize(committed);
    } catch (error) {
      // An unsettled reservation is released by the stale-reservation sweep.
      console.error("[workspace] usage settlement failed:", error instanceof Error ? error.message : error);
    }
  }
}

/**
 * - `false`: read-only snapshot; a GET that mutates the snapshot retries under the lock.
 * - `true`: short writes under a Postgres row lock across instances.
 * - `"optimistic"`: long jobs (analyses). No lock or connection is held while the
 *   job runs; its changes are merged onto the latest version at the end, so the
 *   user's other writes never wait behind a multi-minute model call.
 */
export type WorkspaceMode = boolean | "optimistic";

export async function withWorkspace<T>(
  userId: string,
  mode: WorkspaceMode,
  work: () => Promise<T>,
): Promise<{ value: T; deferred: WorkspaceContext["deferred"] }> {
  if (mode === "optimistic") return withOptimisticWorkspace(userId, work);
  const write = mode;
  const client = await getPool().connect();
  let database: Database.Database | undefined;
  let released = false;
  let context: WorkspaceContext | undefined;
  let committed = false;
  try {
    if (write) {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '10s'");
      await client.query("INSERT INTO workspaces (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
    }
    const { row, serialized } = await selectWorkspace(client, userId, write);
    // Account creation always creates a row; this also handles pre-existing users.
    if (!row && !write) {
      client.release();
      released = true;
      return await withWorkspace(userId, true, work);
    }

    const opened = openWorkspaceDatabase(serialized);
    database = opened.database;

    context = {
      userId,
      database,
      transaction: write ? client : undefined,
      finalizeUsage: write ? [] : undefined,
      dirty: opened.dirty,
      deferred: [],
      state: new Map(),
      deadline: Date.now() + 240_000,
    };

    const value = await workspaceContext.run(context, work);

    if (context.dirty) {
      const snapshot = serializeForStorage(database);
      const payload = encodeWorkspaceBuffer(snapshot, userId);
      const nextVersion = (row?.version ?? 0) + 1;
      const updated = await client.query(
        "UPDATE workspaces SET payload = $1, version = version + 1, updated_at = now() WHERE user_id = $2 AND version = $3",
        [payload, userId, row?.version ?? 0],
      );
      if (!updated.rowCount) {
        if (write) throw new Error("Workspace version conflict while holding the row lock");
        // A GET mutated the snapshot but another instance committed first.
        // Re-run under the row lock so the cache write is not silently lost.
        database.close();
        database = undefined;
        client.release();
        released = true;
        return await withWorkspace(userId, true, work);
      }
      setCachedSnapshot(userId, nextVersion, snapshot);
    }

    if (write) await client.query("COMMIT");
    committed = true;
    return { value, deferred: context.deferred };
  } catch (error) {
    if (write) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    database?.close();
    if (!released) client.release();
    if (context) await settleUsage(context, committed);
  }
}

async function withOptimisticWorkspace<T>(
  userId: string,
  work: () => Promise<T>,
): Promise<{ value: T; deferred: WorkspaceContext["deferred"] }> {
  const pool = getPool();
  let loaded = await selectWorkspace(pool, userId, false);
  if (!loaded.row) {
    await pool.query("INSERT INTO workspaces (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
    loaded = await selectWorkspace(pool, userId, false);
  }
  const baseVersion = loaded.row?.version ?? 0;
  const baseSnapshot = loaded.serialized;
  const { database, dirty } = openWorkspaceDatabase(baseSnapshot);

  const context: WorkspaceContext = {
    userId,
    database,
    finalizeUsage: [],
    dirty,
    deferred: [],
    state: new Map(),
    deadline: Date.now() + 240_000,
  };
  let committed = false;
  try {
    const value = await workspaceContext.run(context, work);
    if (context.dirty) await commitOptimistic(userId, database, baseSnapshot, baseVersion);
    committed = true;
    return { value, deferred: context.deferred };
  } finally {
    database.close();
    await settleUsage(context, committed);
  }
}

async function commitOptimistic(
  userId: string,
  changed: Database.Database,
  baseSnapshot: Buffer | undefined,
  baseVersion: number,
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '10s'");
    const { row: latest, serialized: latestSnapshot } = await selectWorkspace(client, userId, true);
    if (!latest) throw new Error("Workspace row is missing");

    let snapshot: Buffer;
    if (latest.version === baseVersion) {
      snapshot = serializeForStorage(changed);
    } else {
      // Another request committed while this job ran: replay only this job's
      // row changes onto the newer version instead of overwriting it.
      const base = openWorkspaceDatabase(baseSnapshot).database;
      const target = openWorkspaceDatabase(latestSnapshot).database;
      try {
        const stats = mergeWorkspaceChanges(base, changed, target);
        console.info(
          `[workspace] merged concurrent changes upserted=${stats.upserted} deleted=${stats.deleted} skipped=${stats.skipped}`,
        );
        snapshot = serializeForStorage(target);
      } finally {
        base.close();
        target.close();
      }
    }

    await client.query(
      "UPDATE workspaces SET payload = $1, version = version + 1, updated_at = now() WHERE user_id = $2",
      [encodeWorkspaceBuffer(snapshot, userId), userId],
    );
    await client.query("COMMIT");
    setCachedSnapshot(userId, latest.version + 1, snapshot);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
