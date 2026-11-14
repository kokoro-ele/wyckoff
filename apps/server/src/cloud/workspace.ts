import Database from "better-sqlite3";
import { gzipSync, gunzipSync } from "node:zlib";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getPool } from "./postgres.js";
import { initializeDatabase } from "../db/schema.js";
import { workspaceContext, type WorkspaceContext } from "./context.js";

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

function setCachedSnapshot(userId: string, version: number, serialized: Buffer): void {
  if (serialized.length > MAX_CACHE_BYTES) return;
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

// Writes use a Postgres row lock across instances. GET requests read committed
// snapshots without waiting for long jobs; cache writes use a version CAS.
export async function withWorkspace<T>(
  userId: string,
  write: boolean,
  work: () => Promise<T>,
): Promise<{ value: T; deferred: WorkspaceContext["deferred"] }> {
  const client = await getPool().connect();
  let database: Database.Database | undefined;
  let released = false;
  try {
    if (write) {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '10s'");
      await client.query("INSERT INTO workspaces (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [userId]);
    }
    const { rows } = await client.query<{ payload: Buffer | null; version: number }>(
      `SELECT payload, version FROM workspaces WHERE user_id = $1${write ? " FOR UPDATE" : ""}`,
      [userId],
    );
    const row = rows[0];
    // Account creation always creates a row; this also handles pre-existing users.
    if (!row && !write) {
      client.release();
      released = true;
      return await withWorkspace(userId, true, work);
    }

    let serialized = row?.payload ? getCachedSnapshot(userId, row.version) : undefined;
    if (row?.payload && !serialized) {
      try {
        serialized = decodeWorkspace(row.payload, userId);
      } catch (error) {
        if (error instanceof RangeError || (error as NodeJS.ErrnoException)?.code === "ERR_BUFFER_TOO_LARGE") {
          throw new WorkspaceTooLargeError();
        }
        throw error;
      }
      setCachedSnapshot(userId, row.version, serialized);
    }
    database = new Database(serialized ?? ":memory:");
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

    const context: WorkspaceContext = {
      userId,
      database,
      transaction: write ? client : undefined,
      finalizeUsage: [],
      dirty: schemaChanged || legacyCacheRemoved,
      deferred: [],
      state: new Map(),
      deadline: Date.now() + 240_000,
    };

    const stale = database
      .prepare(
        "UPDATE ai_backtest_runs SET status = 'failed', error = '云端任务超过执行时限，请缩小回测范围后重试', updated_at = ? WHERE status IN ('queued', 'running') AND updated_at < ?",
      )
      .run(Date.now(), Date.now() - 300_000);
    if (stale.changes > 0) context.dirty = true;

    const value = await workspaceContext.run(context, work);

    if (context.dirty) {
      let snapshot = database.serialize();
      if (snapshot.length > COMPACT_AT_BYTES) {
        console.warn("[workspace] compacting oversized workspace cache");
        compactWorkspace(database);
        snapshot = database.serialize();
      }
      if (snapshot.length > MAX_WORKSPACE_BYTES) throw new WorkspaceTooLargeError();

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

    for (const finalize of context.finalizeUsage ?? []) await finalize();
    if (write) await client.query("COMMIT");
    return { value, deferred: context.deferred };
  } catch (error) {
    if (write) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    database?.close();
    if (!released) client.release();
  }
}
