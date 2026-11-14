import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { workspaceContext } from "../cloud/context.js";
import { getPool } from "../cloud/postgres.js";
import { createPriceAlert, deletePriceAlert, listPriceAlerts } from "../services/priceAlerts.js";

export const alertRoutes = new Hono();

alertRoutes.get("/", async (c) => {
  const userId = workspaceContext.getStore()?.userId;
  if (!userId) return c.json({ code: "AUTH_REQUIRED", message: "请先登录" }, 401);
  return c.json({ alerts: await listPriceAlerts(getPool(), userId) });
});

alertRoutes.post("/", bodyLimit({ maxSize: 8 * 1024 }), async (c) => {
  const userId = workspaceContext.getStore()?.userId;
  if (!userId) return c.json({ code: "AUTH_REQUIRED", message: "请先登录" }, 401);
  const body = (await c.req.json().catch(() => null)) as {
    symbol?: unknown;
    period?: unknown;
    adjust?: unknown;
    targetPrice?: unknown;
    label?: unknown;
    language?: unknown;
  } | null;
  const symbol = typeof body?.symbol === "string" ? body.symbol.trim() : "";
  const period = typeof body?.period === "string" ? body.period : "1d";
  const adjust = typeof body?.adjust === "string" ? body.adjust : "forward";
  const targetPrice = Number(body?.targetPrice);
  const label = typeof body?.label === "string" ? body.label.trim().slice(0, 120) : "";
  const language = body?.language === "en" ? "en" : "zh";
  if (!symbol || !Number.isFinite(targetPrice) || targetPrice <= 0) {
    return c.json({ code: "BAD_REQUEST", message: "缺少 symbol 或有效目标价" }, 400);
  }
  try {
    return c.json(await createPriceAlert(getPool(), userId, {
      symbol,
      period,
      adjust,
      targetPrice,
      label: label || `Target ${targetPrice}`,
      language,
    }));
  } catch (error) {
    return c.json({ code: "ALERT_UNAVAILABLE", message: (error as Error).message || "提醒设置失败" }, 503);
  }
});

alertRoutes.delete("/:id", async (c) => {
  const userId = workspaceContext.getStore()?.userId;
  if (!userId) return c.json({ code: "AUTH_REQUIRED", message: "请先登录" }, 401);
  const deleted = await deletePriceAlert(getPool(), userId, c.req.param("id"));
  return deleted ? c.json({ ok: true }) : c.json({ code: "NOT_FOUND", message: "提醒不存在" }, 404);
});
