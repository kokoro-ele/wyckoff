import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { workspaceContext } from "../cloud/context.js";
import { getPool } from "../cloud/postgres.js";
import { createBugReport, listMyBugReports } from "../services/bugs.js";

export const bugRoutes = new Hono();

bugRoutes.get("/", async (c) => {
  const userId = workspaceContext.getStore()?.userId;
  if (!userId) return c.json({ code: "AUTH_REQUIRED", message: "请先登录" }, 401);
  return c.json({ reports: await listMyBugReports(getPool(), userId) });
});

bugRoutes.post("/", bodyLimit({ maxSize: 8 * 1024 }), async (c) => {
  const userId = workspaceContext.getStore()?.userId;
  if (!userId) return c.json({ code: "AUTH_REQUIRED", message: "请先登录" }, 401);
  const body = (await c.req.json().catch(() => null)) as {
    title?: unknown;
    body?: unknown;
    pageUrl?: unknown;
  } | null;
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const details = typeof body?.body === "string" ? body.body.trim() : "";
  const pageUrl = typeof body?.pageUrl === "string" ? body.pageUrl : "";
  if (!title || !details) return c.json({ code: "BAD_REQUEST", message: "请填写问题标题和描述" }, 400);
  return c.json({ report: await createBugReport(getPool(), userId, { title, body: details, pageUrl }) });
});
