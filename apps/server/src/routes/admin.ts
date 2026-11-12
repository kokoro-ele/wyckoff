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
