import type { Pool, PoolClient } from "pg";

export const EARLY_BIRD_LIMIT = 100;
export const EARLY_BIRD_CREDITS = 10;

type DB = Pool | PoolClient;

export interface UserIdentity {
  user_id: string;
  public_id: string;
  ordinal: number;
}

export function publicUserId(ordinal: number): string {
  return `WY-${String(ordinal).padStart(6, "0")}`;
}

export async function getIdentity(pool: DB, userId: string): Promise<UserIdentity | null> {
  return (
    await pool.query<UserIdentity>(
      "SELECT user_id,public_id,ordinal FROM user_identity WHERE user_id=$1",
      [userId],
    )
  ).rows[0] ?? null;
}

/** Creates the stable public user number. Safe to call more than once. */
export async function registerIdentity(pool: Pool, userId: string): Promise<UserIdentity> {
  const existing = await getIdentity(pool, userId);
  if (existing) return existing;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('user_identity'))");
    const again = await getIdentity(client, userId);
    if (again) {
      await client.query("COMMIT");
      return again;
    }
    const ordinal = Number(
      (await client.query<{ next: string }>("SELECT COALESCE(max(ordinal),0)+1 AS next FROM user_identity"))
        .rows[0]?.next ?? 1,
    );
    const row = (
      await client.query<UserIdentity>(
        "INSERT INTO user_identity(user_id,public_id,ordinal) VALUES($1,$2,$3) RETURNING user_id,public_id,ordinal",
        [userId, publicUserId(ordinal), ordinal],
      )
    ).rows[0];
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function welcomeCreditsFor(identity: UserIdentity | null): number {
  return identity && identity.ordinal <= EARLY_BIRD_LIMIT ? EARLY_BIRD_CREDITS : 3;
}
