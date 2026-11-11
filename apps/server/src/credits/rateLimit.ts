import type { Pool, PoolClient } from "pg";

/**
 * Small PostgreSQL-backed fixed-window limiter for expensive authenticated or
 * anonymous endpoints. Unlike an in-process map it works across instances.
 */
export async function consumeRateLimit(
  db: Pool | PoolClient,
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const result = await db.query<{ count: number }>(
    `INSERT INTO api_rate_limits(key,window_start,count) VALUES($1,$2,1)
     ON CONFLICT(key,window_start) DO UPDATE SET count=api_rate_limits.count+1
     RETURNING count`,
    [key, windowStart],
  );
  // Best-effort cleanup; the table is tiny and only written on limited paths.
  if (Math.random() < 0.02) {
    await db
      .query("DELETE FROM api_rate_limits WHERE window_start < now() - interval '1 day'")
      .catch(() => undefined);
  }
  return Number(result.rows[0]?.count ?? 1) <= limit;
}
