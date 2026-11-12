import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getAuth } from "../cloud/auth.js";
import { getPool } from "../cloud/postgres.js";

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
  const [users, verified, credits, analyses, orders, signups, recentOrders] = await Promise.all([
    pool.query<{ count: string }>('SELECT count(*) FROM "user"'),
    pool.query<{ count: string }>('SELECT count(*) FROM "user" WHERE "emailVerified"=true'),
    pool.query<{ total: string | null }>("SELECT COALESCE(sum(balance),0)::text AS total FROM credit_accounts"),
    pool.query<{ count: string }>("SELECT count(*) FROM credit_usage WHERE state='consumed'"),
    pool.query<{ count: string; revenue: string | null }>(
      "SELECT count(*)::text AS count, COALESCE(sum(amount),0)::text AS revenue FROM billing_orders WHERE status='paid'",
    ),
    pool.query('SELECT id,email,name,"emailVerified","createdAt" FROM "user" ORDER BY "createdAt" DESC LIMIT 8'),
    pool.query(
      "SELECT id,user_id,plan,period,credits,amount,currency,status,created_at FROM billing_orders ORDER BY created_at DESC LIMIT 8",
    ),
  ]);
  return c.json({
    users: Number(users.rows[0]?.count ?? 0),
    verified: Number(verified.rows[0]?.count ?? 0),
    credits: Number(credits.rows[0]?.total ?? 0),
    analyses: Number(analyses.rows[0]?.count ?? 0),
    orders: Number(orders.rows[0]?.count ?? 0),
    revenueMinor: Number(orders.rows[0]?.revenue ?? 0),
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
       (SELECT count(*) FROM credit_usage cu WHERE cu.user_id=u.id AND cu.state='consumed') AS analyses
     FROM "user" u
     LEFT JOIN credit_accounts c ON c.user_id=u.id
     ${where}
     ORDER BY u."createdAt" DESC
     LIMIT 100`,
    params,
  );
  return c.json({ users: rows });
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
