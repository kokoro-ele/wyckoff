import { Pool } from "pg";

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  let connectionString = process.env.DATABASE_URL;
  const ca = process.env.DATABASE_SSL_CA;
  if (ca) {
    const url = new URL(connectionString);
    // pg connection-string SSL parameters override the explicit TLS options.
    for (const key of ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(key);
    connectionString = url.toString();
  }
  if (!pool) {
    const max = Math.max(1, Number(process.env.PG_POOL_MAX ?? 10) || 10);
    pool = new Pool({
      connectionString,
      ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
      max,
      connectionTimeoutMillis: 15_000,
      idleTimeoutMillis: 20_000,
    });
    // An unhandled idle-client error would crash the Node process.
    pool.on("error", (error) => {
      console.error("[postgres] idle client error:", error.message);
    });
  }
  return pool;
}
