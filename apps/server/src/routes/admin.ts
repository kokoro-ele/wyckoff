import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getAuth } from "../cloud/auth.js";
import { getPool } from "../cloud/postgres.js";
import { grantEntitlement, revokeEntitlement } from "../billing/entitlements.js";
import { confirmBugReport, listBugReports, rejectBugReport } from "../services/bugs.js";

export const adminRoutes = new Hono();

function admins(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

async function isAdmin(headers: Headers): Promise<boolean> {
  const session = await getAuth().api.getSession({ headers });
  return Boolean(
    session?.user.emailVerified &&
      admins().includes(session.user.email.toLowerCase()),
  );
}

async function guard(c: Context) {
  if (!(await isAdmin(c.req.raw.headers))) {
    return c.json({ code: "FORBIDDEN", message: "需要管理员权限" }, 403);
  }
  return null;
}

adminRoutes.get("/overview", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;
  const pool = getPool();
  const [users, verified, credits, analyses, orders, revenue, signups, recentOrders] = await Promise.all([
    pool.query<{ count: string }>('SELECT count(*) FROM "user"'),
    pool.query<{ count: string }>('SELECT count(*) FROM "user" WHERE "emailVerified"=true'),
    pool.query<{ total: string | null }>("SELECT COALESCE(sum(balance),0)::text AS total FROM credit_accounts"),
    pool.query<{ count: string }>("SELECT count(*) FROM credit_usage WHERE state='consumed'"),
    pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM (
         SELECT id FROM billing_orders WHERE status='paid'
         UNION ALL
         SELECT id FROM subscription_orders WHERE status='paid'
       ) paid`,
    ),
    pool.query<{ currency: string; amount: string }>(
      `SELECT currency, sum(amount)::text AS amount FROM (
         SELECT amount,currency FROM billing_orders WHERE status='paid'
         UNION ALL
         SELECT amount,currency FROM subscription_orders WHERE status='paid'
       ) paid GROUP BY currency ORDER BY currency`,
    ),
    pool.query('SELECT id,email,name,"emailVerified","createdAt" FROM "user" ORDER BY "createdAt" DESC LIMIT 8'),
    pool.query(
      `SELECT * FROM (
         SELECT o.id,o.user_id,u.email,o.plan AS product,o.period,o.credits,o.amount,o.currency,
                CASE WHEN o.status IN ('creating','pending') AND o.expires_at<=now() THEN 'expired' ELSE o.status END AS status,
                o.created_at,'credits'::text AS source, o.provider AS provider
         FROM billing_orders o JOIN "user" u ON u.id=o.user_id
         UNION ALL
         SELECT s.id,s.user_id,u.email,s.product,NULL::text AS period,NULL::int AS credits,s.amount,s.currency,
                CASE WHEN s.status IN ('creating','pending') AND s.expires_at<=now() THEN 'expired' ELSE s.status END AS status,
                s.created_at,'byok'::text AS source,'stripe'::text AS provider
         FROM subscription_orders s JOIN "user" u ON u.id=s.user_id
       ) orders ORDER BY created_at DESC LIMIT 12`,
    ),
  ]);
  return c.json({
    users: Number(users.rows[0]?.count ?? 0),
    verified: Number(verified.rows[0]?.count ?? 0),
    credits: Number(credits.rows[0]?.total ?? 0),
    analyses: Number(analyses.rows[0]?.count ?? 0),
    orders: Number(orders.rows[0]?.count ?? 0),
    revenueByCurrency: revenue.rows.map((row) => ({ currency: row.currency, amount: Number(row.amount) })),
    recentSignups: signups.rows,
    recentOrders: recentOrders.rows,
  });
});


adminRoutes.get("/analytics", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;
  const pool = getPool();
  const [signups, logins, analyses, today, retention, perUser] = await Promise.all([
    pool.query(
      `SELECT to_char("createdAt",'YYYY-MM-DD') AS date, count(*)::int AS count
       FROM "user" WHERE "createdAt" >= now() - interval '30 days'
       GROUP BY 1 ORDER BY 1`,
    ),
    pool.query(
      `SELECT to_char("createdAt",'YYYY-MM-DD') AS date, count(DISTINCT "userId")::int AS count
       FROM session WHERE "createdAt" >= now() - interval '30 days'
       GROUP BY 1 ORDER BY 1`,
    ),
    pool.query(
      `SELECT to_char(created_at,'YYYY-MM-DD') AS date, count(*)::int AS analyses,
              count(DISTINCT user_id)::int AS users
       FROM credit_usage
       WHERE state='consumed' AND created_at >= now() - interval '30 days'
       GROUP BY 1 ORDER BY 1`,
    ),
    pool.query(
      `SELECT
        (SELECT count(*)::int FROM "user" WHERE "createdAt"::date = current_date) AS "newToday",
        (SELECT count(DISTINCT "userId")::int FROM session WHERE "createdAt"::date = current_date) AS "loginsToday",
        (SELECT count(*)::int FROM credit_usage WHERE state='consumed' AND created_at::date = current_date) AS "analysesToday",
        (SELECT count(DISTINCT user_id)::int FROM credit_usage WHERE state='consumed' AND created_at >= now() - interval '7 days') AS "active7d"`,
    ),
    pool.query(
      `WITH s AS (
         SELECT id, "createdAt"::date AS day FROM "user" WHERE "createdAt" >= now() - interval '30 days'
       ), a AS (
         SELECT DISTINCT "userId", "createdAt"::date AS day FROM session
       )
       SELECT s.day::text AS date, count(*)::int AS signups,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM a WHERE a."userId"=s.id AND a.day=s.day + 1
         ))::int AS "d1"
       FROM s GROUP BY s.day ORDER BY s.day`,
    ),
    pool.query(
      `SELECT u.email, u.name, count(*)::int AS analyses
       FROM credit_usage cu JOIN "user" u ON u.id=cu.user_id
       WHERE cu.state='consumed' AND cu.created_at >= now() - interval '30 days'
       GROUP BY u.id,u.email,u.name ORDER BY analyses DESC LIMIT 10`,
    ),
  ]);
  const totalAnalyses = analyses.rows.reduce((sum, row) => sum + row.analyses, 0);
  const [totals] = (
    await pool.query<{ users: string; active: string }>(
      `SELECT
        (SELECT count(*)::text FROM "user" WHERE "emailVerified"=true) AS users,
        (SELECT count(DISTINCT user_id)::text FROM credit_usage WHERE state='consumed' AND created_at >= now() - interval '30 days') AS active`,
    )
  ).rows;
  return c.json({
    signups: signups.rows,
    logins: logins.rows,
    analyses: analyses.rows,
    today: today.rows[0] ?? { newToday: 0, loginsToday: 0, analysesToday: 0, active7d: 0 },
    retention: retention.rows,
    perUser: perUser.rows,
    cost: {
      analyses30d: totalAnalyses,
      avgPerVerifiedUser: Number(totals?.users ?? 0) ? totalAnalyses / Number(totals.users) : 0,
      avgPerActiveUser: Number(totals?.active ?? 0) ? totalAnalyses / Number(totals.active) : 0,
      creditsPerAnalysis: 1,
      note: "当前只记录分析次数/credits，未记录模型 token 成本；精确美元成本需要接入模型 usage 字段。",
    },
  });
});

async function stripeGet(path: string): Promise<Record<string, any>> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured");
  const response = await fetch(`https://api.stripe.com${path}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": "2025-02-24.acacia",
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok) throw new Error(body.error?.message ?? `Stripe returned ${response.status}`);
  return body;
}

adminRoutes.get("/stripe/health", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;
  const orderId = (c.req.query("orderId") ?? "").trim();
  let order: {
    id: string;
    kind: "credits" | "subscription";
    status: string;
    amount: number;
    currency: string;
    createdAt: Date;
    sessionId: string | null;
  } | null = null;
  if (orderId) {
    const row = (
      await getPool().query<{
        id: string;
        kind: "credits" | "subscription";
        status: string;
        amount: number;
        currency: string;
        created_at: Date;
        session_id: string | null;
      }>(
        `SELECT id,'credits'::text AS kind,status,amount,currency,created_at,provider_id AS session_id
           FROM billing_orders WHERE id=$1
         UNION ALL
         SELECT id,'subscription'::text AS kind,status,amount,currency,created_at,stripe_session_id AS session_id
           FROM subscription_orders WHERE id=$1
         LIMIT 1`,
        [orderId],
      )
    ).rows[0];
    if (row) {
      order = {
        id: row.id,
        kind: row.kind,
        status: row.status,
        amount: row.amount,
        currency: row.currency,
        createdAt: row.created_at,
        sessionId: row.session_id,
      };
    }
  }

  const [account, webhooks, session] = await Promise.all([
    stripeGet("/v1/account").catch((error) => ({ error: (error as Error).message })),
    stripeGet("/v1/webhook_endpoints?limit=20").catch((error) => ({ error: (error as Error).message })),
    order?.sessionId
      ? stripeGet(
          `/v1/checkout/sessions/${encodeURIComponent(order.sessionId)}?expand[]=payment_intent&expand[]=subscription`,
        ).catch((error) => ({ error: (error as Error).message }))
      : Promise.resolve(null),
  ]);

  const a = account as Record<string, any>;
  const accountSafe = a.error
    ? { error: String(a.error) }
    : {
        id: a.id,
        country: a.country,
        default_currency: a.default_currency,
        charges_enabled: a.charges_enabled,
        payouts_enabled: a.payouts_enabled,
        details_submitted: a.details_submitted,
        currently_due: a.requirements?.currently_due ?? [],
        disabled_reason: a.requirements?.disabled_reason ?? null,
      };
  const w = webhooks as Record<string, any>;
  const webhookSafe = w.error
    ? { error: String(w.error) }
    : {
        endpoints: (w.data ?? []).map((endpoint: Record<string, any>) => ({
          id: endpoint.id,
          url: endpoint.url,
          status: endpoint.status,
          enabled_events: endpoint.enabled_events,
          api_version: endpoint.api_version,
        })),
      };
  let sessionSafe: Record<string, any> | null = null;
  if (session) {
    const s = session as Record<string, any>;
    if (s.error) {
      sessionSafe = { error: String(s.error) };
    } else {
      sessionSafe = {
        id: s.id,
        mode: s.mode,
        status: s.status,
        payment_status: s.payment_status,
        amount_total: s.amount_total,
        currency: s.currency,
        created: s.created,
        expires_at: s.expires_at,
        client_reference_id: s.client_reference_id,
        payment_method_types: s.payment_method_types,
        payment_intent:
          s.payment_intent && typeof s.payment_intent === "object"
            ? {
                id: s.payment_intent.id,
                status: s.payment_intent.status,
                amount: s.payment_intent.amount,
                last_payment_error: s.payment_intent.last_payment_error
                  ? {
                      code: s.payment_intent.last_payment_error.code,
                      message: s.payment_intent.last_payment_error.message,
                      type: s.payment_intent.last_payment_error.type,
                    }
                  : null,
              }
            : s.payment_intent,
        subscription:
          s.subscription && typeof s.subscription === "object"
            ? {
                id: s.subscription.id,
                status: s.subscription.status,
                cancel_at_period_end: s.subscription.cancel_at_period_end,
              }
            : s.subscription,
      };
    }
  }
  return c.json({ order, account: accountSafe, webhooks: webhookSafe, session: sessionSafe });
});


adminRoutes.get("/demo-trials", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;
  const { rows } = await getPool().query(
    `SELECT key, window_start, count
     FROM api_rate_limits
     WHERE key LIKE 'demo:%'
     ORDER BY window_start DESC
     LIMIT 200`,
  );
  return c.json({
    trials: rows.map((row) => ({
      key: row.key,
      windowStart: row.window_start,
      count: row.count,
    })),
  });
});

adminRoutes.post("/demo-trials/clear", bodyLimit({ maxSize: 8 * 1024 }), async (c) => {
  const denied = await guard(c);
  if (denied) return denied;
  const body = (await c.req.json().catch(() => null)) as { key?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key : "";
  if (key && !key.startsWith("demo:")) {
    return c.json({ code: "BAD_REQUEST", message: "只能清除 demo 试用记录" }, 400);
  }
  const result = await getPool().query(
    key
      ? "DELETE FROM api_rate_limits WHERE key=$1 AND key LIKE 'demo:%'"
      : "DELETE FROM api_rate_limits WHERE key LIKE 'demo:%'",
    key ? [key] : [],
  );
  return c.json({ ok: true, cleared: result.rowCount ?? 0 });
});

adminRoutes.get("/bugs", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;
  return c.json({ reports: await listBugReports(getPool()) });
});

adminRoutes.post("/bugs/:id/confirm", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;
  const result = await confirmBugReport(getPool(), c.req.param("id"));
  if (!result.ok) return c.json({ code: result.reason === "not_found" ? "NOT_FOUND" : "BAD_REQUEST" }, result.reason === "not_found" ? 404 : 400);
  return c.json(result);
});

adminRoutes.post("/bugs/:id/reject", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;
  const ok = await rejectBugReport(getPool(), c.req.param("id"));
  return ok ? c.json({ ok: true }) : c.json({ code: "NOT_FOUND" }, 404);
});

adminRoutes.get("/feedback", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;
  const { rows } = await getPool().query(
    `SELECT f.user_id, f.rating, f.comment, f.credits_granted, f.created_at, u.email
     FROM feedback_responses f JOIN "user" u ON u.id=f.user_id
     ORDER BY f.created_at DESC LIMIT 100`,
  );
  return c.json({ feedback: rows });
});

adminRoutes.get("/users", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;
  const query = (c.req.query("query") ?? "").trim().slice(0, 80);
  const params: string[] = [];
  let where = "";
  if (query) {
    where = 'WHERE u.email ILIKE $1 OR u.name ILIKE $1';
    params.push(`%${query}%`);
  }
  const { rows } = await getPool().query(
    `SELECT u.id,u.email,u.name,u."emailVerified",u."createdAt",
       COALESCE(c.balance,0) AS balance, c.invite_code AS "inviteCode",
       i.public_id AS "publicId", i.ordinal,
       (SELECT count(*) FROM credit_usage cu WHERE cu.user_id=u.id AND cu.state='consumed') AS analyses,
       (SELECT COALESCE(sum(cu.credits),0)::int FROM credit_usage cu WHERE cu.user_id=u.id AND cu.state='consumed') AS spent,
       e.status AS "byokStatus", e.source AS "byokSource", e.current_period_end AS "byokEnd",
       COALESCE(e.status='active' AND (e.current_period_end IS NULL OR e.current_period_end>now()),false) AS "byokActive"
     FROM "user" u
     LEFT JOIN credit_accounts c ON c.user_id=u.id
     LEFT JOIN user_identity i ON i.user_id=u.id
     LEFT JOIN access_entitlements e ON e.user_id=u.id AND e.product='byok' 
     ${where}
     ORDER BY u."createdAt" DESC
     LIMIT 100`,
    params,
  );
  return c.json({ users: rows });
});

adminRoutes.delete("/users/:id", async (c) => {
  const denied = await guard(c);
  if (denied) return denied;
  const userId = c.req.param("id");
  if (!userId) return c.json({ code: "BAD_REQUEST", message: "缺少 userId" }, 400);
  const pool = getPool();
  const target = await pool.query<{ email: string }>('SELECT email FROM "user" WHERE id=$1', [userId]);
  const user = target.rows[0];
  if (!user) return c.json({ code: "NOT_FOUND", message: "用户不存在" }, 404);
  if (admins().includes(user.email.toLowerCase())) {
    return c.json({ code: "FORBIDDEN", message: "不能删除管理员账户" }, 403);
  }
  // Better Auth, workspace, credits, billing and identity tables all cascade
  // from "user"; a single delete removes the account and its private data.
  await pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
  console.log(`[admin] deleted user ${user.email} (${userId})`);
  return c.json({ ok: true, deleted: userId });
});

adminRoutes.post(
  "/credits",
  bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json({ code: "TOO_LARGE" }, 413) }),
  async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const body = (await c.req.json().catch(() => null)) as { userId?: unknown; balance?: unknown } | null;
    const userId = typeof body?.userId === "string" ? body.userId : "";
    const balance = Number(body?.balance);
    if (!userId || !Number.isInteger(balance) || balance < 0 || balance > 100000) {
      return c.json({ code: "BAD_REQUEST", message: "参数无效" }, 400);
    }
    const result = await getPool().query(
      "UPDATE credit_accounts SET balance=$2 WHERE user_id=$1",
      [userId, balance],
    );
    return c.json({ ok: true, updated: result.rowCount ?? 0, balance });
  },
);

adminRoutes.post(
  "/entitlements",
  bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json({ code: "TOO_LARGE" }, 413) }),
  async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const body = (await c.req.json().catch(() => null)) as
      | { userId?: unknown; active?: unknown; days?: unknown }
      | null;
    const userId = typeof body?.userId === "string" ? body.userId : "";
    if (!userId || !body || typeof body.active !== "boolean") {
      return c.json({ code: "BAD_REQUEST", message: "参数无效" }, 400);
    }
    if (!body.active) {
      await revokeEntitlement(getPool(), userId, "byok");
      return c.json({ ok: true, active: false });
    }
    let days: number | null = null;
    if (body.days !== undefined && body.days !== null) {
      const parsed = Number(body.days);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return c.json({ code: "BAD_REQUEST", message: "有效天数无效" }, 400);
      }
      days = Math.min(Math.floor(parsed), 3650);
    }
    await grantEntitlement(getPool(), userId, {
      product: "byok",
      source: "admin",
      currentPeriodEnd: days === null ? null : new Date(Date.now() + days * 86_400_000),
    });
    return c.json({ ok: true, active: true, days });
  },
);

adminRoutes.post(
  "/credits/reset",
  bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json({ code: "TOO_LARGE" }, 413) }),
  async (c) => {
    const denied = await guard(c);
    if (denied) return denied;
    const body = (await c.req.json().catch(() => null)) as { balance?: unknown } | null;
    const balance = body?.balance === undefined ? 3 : Number(body.balance);
    if (!Number.isInteger(balance) || balance < 0 || balance > 100000) {
      return c.json({ code: "BAD_REQUEST", message: "参数无效" }, 400);
    }
    const result = await getPool().query("UPDATE credit_accounts SET balance=$1", [balance]);
    return c.json({ ok: true, updated: result.rowCount ?? 0, balance });
  },
);
