import { type AdjustType, type Period } from "@wyckoff/shared";
import { Hono } from "hono";
import { getAgentTradePlan, listStrategySnapshots, saveStrategySnapshot } from "../services/tradePlan.js";

export const tradePlanRoutes = new Hono();

tradePlanRoutes.get("/", (c) => {
  const symbol = c.req.query("symbol") ?? "";
  const period = (c.req.query("period") ?? "1d") as Period;
  const adjust = (c.req.query("adjust") ?? "forward") as AdjustType;
  if (!symbol) return c.json({ code: "BAD_REQUEST", message: "缺少 symbol" }, 400);
  return c.json({ plan: getAgentTradePlan(symbol, period, adjust) });
});

tradePlanRoutes.get("/saved", (c) => {
  const symbol = c.req.query("symbol") ?? "";
  const period = (c.req.query("period") ?? "1d") as Period;
  const adjust = (c.req.query("adjust") ?? "forward") as AdjustType;
  if (!symbol) return c.json({ code: "BAD_REQUEST", message: "缺少 symbol" }, 400);
  return c.json({ strategies: listStrategySnapshots(symbol, period, adjust) });
});

tradePlanRoutes.post("/save", (c) => {
  const symbol = c.req.query("symbol") ?? "";
  const period = (c.req.query("period") ?? "1d") as Period;
  const adjust = (c.req.query("adjust") ?? "forward") as AdjustType;
  if (!symbol) return c.json({ code: "BAD_REQUEST", message: "缺少 symbol" }, 400);
  const plan = getAgentTradePlan(symbol, period, adjust);
  if (!plan) return c.json({ code: "NOT_FOUND", message: "还没有可保存的交易计划" }, 404);
  return c.json({ strategy: saveStrategySnapshot(symbol, period, adjust, plan) });
});
