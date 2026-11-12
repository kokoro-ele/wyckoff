import { type AdjustType, type Period } from "@wyckoff/shared";
import { Hono } from "hono";
import { getAgentTradePlan } from "../services/tradePlan.js";

export const tradePlanRoutes = new Hono();

tradePlanRoutes.get("/", (c) => {
  const symbol = c.req.query("symbol") ?? "";
  const period = (c.req.query("period") ?? "1d") as Period;
  const adjust = (c.req.query("adjust") ?? "forward") as AdjustType;
  if (!symbol) return c.json({ code: "BAD_REQUEST", message: "缺少 symbol" }, 400);
  return c.json({ plan: getAgentTradePlan(symbol, period, adjust) });
});
