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
         SELECT o.id,o.user_id,u.email,o.plan AS product,o.period,o.credits,o.amount,o.currency,o.status,o.created_at,
                'credits'::text AS source, o.provider AS provider
         FROM billing_orders o JOIN "user" u ON u.id=o.user_id
         UNION ALL
         SELECT s.id,s.user_id,u.email,s.product,NULL::text AS period,NULL::int AS credits,s.amount,s.currency,s.status,s.created_at,
                'byok'::text AS source,'stripe'::text AS provider
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
       (SELECT COALESCE(sum(cu.credits),0)::int FROM credit_usage cu WHERE cu.user_id=u.id AND cu.state='consumed') AS spent
     FROM "user" u
     LEFT JOIN credit_accounts c ON c.user_id=u.id
     LEFT JOIN user_identity i ON i.user_id=u.id
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
    if (!userId) return c.json({ code: "BAD_REQUEST", message: "缺少 userId" }, 400);
    if (body?.active === false) {
      await revokeEntitlement(getPool(), userId, "byok");
      return c.json({ ok: true, active: false });
    }
    const days = body?.days === undefined ? null : Math.min(Math.max(1, Number(body.days)), 3650);
    await grantEntitlement(getPool(), userId, {
      product: "byok",
      source: "admin",
      currentPeriodEnd: days ? new Date(Date.now() + days * 86_400_000) : null,
    });
    return c.json({ ok: true, active: true });
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
