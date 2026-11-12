import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { BillingError, plans } from "../billing/catalog.js";
import { withAccountLock } from "../billing/store.js";
import { getIdentity, registerIdentity, welcomeCreditsFor } from "./identity.js";

type DB = Pool | PoolClient;

export const WELCOME_CREDITS = 3;
export const INVITE_CREDITS = 3;

async function ensureAccount(db: DB, userId: string, newUser = false) {
  await db.query(
    `INSERT INTO credit_accounts(user_id,invite_code,new_user)
     VALUES($1,$2,$3) ON CONFLICT(user_id) DO NOTHING`,
    [userId, randomBytes(18).toString("base64url"), newUser],
  );
}

export async function validateInviteCode(db: DB, code: string): Promise<string> {
  if (!/^[\w-]{24}$/.test(code)) throw new BillingError("INVALID_INVITE", "邀请码无效");
  const row = (
    await db.query<{ user_id: string }>("SELECT user_id FROM credit_accounts WHERE invite_code=$1", [code])
  ).rows[0];
  if (!row) throw new BillingError("INVALID_INVITE", "邀请码无效");
  return row.user_id;
}

/** Called exclusively from the new-user creation hook, never from login. */
export async function registerCreditAccount(pool: Pool, userId: string, inviteCode?: string | null) {
  await registerIdentity(pool, userId);
  await withAccountLock(pool, userId, async (db) => {
    const inviter = inviteCode ? await validateInviteCode(db, inviteCode) : null;
    if (inviter === userId) throw new BillingError("INVALID_INVITE", "不能邀请自己");
    await db.query(
      `INSERT INTO credit_accounts(user_id,invite_code,new_user,inviter_id)
       VALUES($1,$2,true,$3) ON CONFLICT(user_id) DO NOTHING`,
      [userId, randomBytes(18).toString("base64url"), inviter],
    );
  });
}

export async function addCredits(db: DB, userId: string, amount: number, key: string) {
  await ensureAccount(db, userId);
  const added = await db.query(
    `INSERT INTO credit_ledger(event_key,user_id,amount)
     VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_key`,
    [key, userId, amount],
  );
  if (added.rowCount) {
    await db.query("UPDATE credit_accounts SET balance=balance+$2 WHERE user_id=$1", [userId, amount]);
  }
}

/**
 * Resolves whether a verified user still owns the one-time welcome grant.
 *
 * The normal path is the durable `new_user` flag written by the user.create
 * hook. If that hook failed after the Better Auth user row was inserted, the
 * account is missing; accounts created after the credits migration are still
 * treated as new users. Older accounts are not retroactively gifted.
 */
async function welcomeEligibility(
  db: DB,
  userId: string,
): Promise<{ eligible: boolean; inviterId: string | null }> {
  const account = (
    await db.query<{ new_user: boolean; inviter_id: string | null }>(
      "SELECT new_user,inviter_id FROM credit_accounts WHERE user_id=$1",
      [userId],
    )
  ).rows[0];
  if (account) return { eligible: account.new_user, inviterId: account.inviter_id };

  const user = (await db.query<{ createdAt: Date }>('SELECT "createdAt" FROM "user" WHERE id=$1', [userId]))
    .rows[0];
  if (!user) throw new BillingError("AUTH_REQUIRED", "账号不存在", 401);
  const meta = (await db.query<{ value: string }>("SELECT value FROM credit_meta WHERE key='migrated_at'"))
    .rows[0];
  const cutoff = meta ? Number(meta.value) : Number.NaN;
  const eligible = Number.isFinite(cutoff) && new Date(user.createdAt).getTime() >= cutoff;
  await ensureAccount(db, userId, eligible);
  return { eligible, inviterId: null };
}

export async function grantVerifiedCredits(pool: Pool, userId: string) {
  // Fast path: established users only pay for one indexed lookup per request.
  const existing = (await pool.query<{ new_user: boolean }>(
    "SELECT new_user FROM credit_accounts WHERE user_id=$1",
    [userId],
  )).rows[0];
  if (existing && !existing.new_user) return;

  await withAccountLock(pool, userId, async (db) => {
    const user = (await db.query<{ emailVerified: boolean }>('SELECT "emailVerified" FROM "user" WHERE id=$1', [userId]))
      .rows[0];
    if (!user?.emailVerified) throw new BillingError("EMAIL_UNVERIFIED", "请先验证邮箱", 401);

    const { eligible, inviterId } = await welcomeEligibility(db, userId);
    if (!eligible) return;

    const identity = await getIdentity(db, userId);
    await addCredits(db, userId, welcomeCreditsFor(identity), `welcome:${userId}`);

    if (inviterId) {
      // A deleted inviter must never roll back the invited user's welcome gift.
      await db.query("SAVEPOINT invite_reward");
      try {
        await addCredits(db, inviterId, INVITE_CREDITS, `invite:${userId}`);
        await db.query("RELEASE SAVEPOINT invite_reward");
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT invite_reward");
        await db.query("RELEASE SAVEPOINT invite_reward");
        console.error("[credits] invite reward skipped:", error instanceof Error ? error.message : "unknown error");
      }
    }

    await db.query("UPDATE credit_accounts SET new_user=false WHERE user_id=$1", [userId]);
  });
}

export async function creditStatus(pool: Pool, userId: string) {
  await grantVerifiedCredits(pool, userId);
  const row = (
    await pool.query<{ balance: number; invite_code: string; invite_count: string; public_id: string | null; ordinal: number | null }>(
      `SELECT c.balance,c.invite_code,
        (SELECT count(*) FROM credit_ledger WHERE user_id=$1 AND event_key LIKE 'invite:%') AS invite_count,
        i.public_id, i.ordinal
       FROM credit_accounts c LEFT JOIN user_identity i ON i.user_id=c.user_id
       WHERE c.user_id=$1`,
      [userId],
    )
  ).rows[0];
  if (!row) throw new BillingError("AUTH_REQUIRED", "账号额度尚未初始化", 401);
  return {
    balance: row.balance,
    inviteCode: row.invite_code,
    inviteCount: Number(row.invite_count),
    publicId: row.public_id,
    ordinal: row.ordinal,
    earlyBird: row.ordinal !== null && row.ordinal <= 100,
  };
}

/** Runs on the workspace transaction: rollback restores the reservation and saved result together. */
export async function reserveCredit(db: PoolClient, userId: string, key: string): Promise<string> {
  if (!/^[\w-]{8,128}$/.test(key)) {
    throw new BillingError("INVALID_IDEMPOTENCY_KEY", "分析请求需要有效的 Idempotency-Key");
  }
  const verified = (await db.query('SELECT id FROM "user" WHERE id=$1 AND "emailVerified"=true', [userId]))
    .rowCount;
  if (!verified) throw new BillingError("EMAIL_UNVERIFIED", "请先验证邮箱", 401);

  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`credit-usage:${userId}`]);

  const prior = (
    await db.query<{ id: string; state: "reserved" | "consumed" | "released" }>(
      "SELECT id,state FROM credit_usage WHERE user_id=$1 AND request_key=$2",
      [userId, key],
    )
  ).rows[0];
  if (prior) {
    if (prior.state !== "released") {
      throw new BillingError("DUPLICATE_REQUEST", "该分析已提交，请查看历史记录", 409);
    }
    // A server-side failed attempt was fully refunded. Let the same logical
    // request retry with the original idempotency key.
    await db.query("DELETE FROM billing_usage WHERE id=$1", [prior.id]);
    await db.query("DELETE FROM credit_usage WHERE id=$1", [prior.id]);
  }

  // Preserve already purchased monthly/annual entitlements, without selling new subscriptions.
  const sub = (
    await db.query<{ plan: string }>(
      "SELECT plan FROM billing_subscriptions WHERE user_id=$1 AND expires_at>now()",
      [userId],
    )
  ).rows[0];
  let source: "permanent" | "subscription" = "permanent";
  if (sub) {
    const limit = plans.find((p) => p.id === sub.plan)?.limits.analysis ?? 0;
    const used = (
      await db.query<{ count: string }>(
        `SELECT count(*) FROM billing_usage
         WHERE user_id=$1 AND kind='analysis'
           AND month=date_trunc('month',now() AT TIME ZONE 'UTC')::date
           AND (state='consumed' OR (state='reserved' AND expires_at>now()))`,
        [userId],
      )
    ).rows[0];
    if (Number(used.count) < limit) source = "subscription";
  }

  if (source === "permanent") {
    const deducted = await db.query(
      "UPDATE credit_accounts SET balance=balance-1 WHERE user_id=$1 AND balance>0 RETURNING user_id",
      [userId],
    );
    if (!deducted.rowCount) {
      const account = await db.query("SELECT 1 FROM credit_accounts WHERE user_id=$1", [userId]);
      if (!account.rowCount) {
        throw new BillingError("CREDITS_NOT_READY", "额度尚未初始化，请稍后重试", 503);
      }
      throw new BillingError("QUOTA_EXCEEDED", "分析次数已用完，请充值", 402);
    }
  }

  const id = randomUUID();
  await db.query(
    "INSERT INTO credit_usage(id,user_id,request_key,state,source) VALUES($1,$2,$3,'reserved',$4)",
    [id, userId, key, source],
  );
  if (source === "subscription") {
    await db.query(
      `INSERT INTO billing_usage(id,user_id,kind,request_key,month,state,expires_at)
       VALUES($1,$2,'analysis',$3,date_trunc('month',now() AT TIME ZONE 'UTC')::date,'reserved',now()+interval '24 hours')`,
      [id, userId, `credits:${key}`],
    );
  }
  return id;
}

export async function finalizeCredit(db: PoolClient, userId: string, id: string, success: boolean) {
  const row = (
    await db.query<{ source: "permanent" | "subscription" }>(
      "UPDATE credit_usage SET state=$3 WHERE id=$1 AND user_id=$2 AND state='reserved' RETURNING source",
      [id, userId, success ? "consumed" : "released"],
    )
  ).rows[0];
  if (!row) return;
  if (row.source === "permanent" && !success) {
    await db.query("UPDATE credit_accounts SET balance=balance+1 WHERE user_id=$1", [userId]);
  }
  if (row.source === "subscription") {
    await db.query("UPDATE billing_usage SET state=$2 WHERE id=$1", [id, success ? "consumed" : "released"]);
  }
}
