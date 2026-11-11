import { periodSchema, adjustTypeSchema } from "@wyckoff/shared";
import { Hono } from "hono";
import { z } from "zod";
import { MarketDataError } from "../services/market.js";
import { getResearch } from "../services/research.js";

const researchQuerySchema = z.object({
  symbol: z.string().min(1),
  period: periodSchema.default("1d"),
  adjust: adjustTypeSchema.default("forward"),
});

export const researchRoutes = new Hono();

researchRoutes.get("/", async (c) => {
  const parsed = researchQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
  }
  try {
    const research = await getResearch(parsed.data);
    return c.json(research);
  } catch (error) {
    if (error instanceof MarketDataError) {
      return c.json({ code: error.code, message: error.message }, error.status as 400 | 404 | 500);
    }
    console.error("[research] failed:", error instanceof Error ? error.message : error);
    return c.json({ code: "RESEARCH_UNAVAILABLE", message: "研究数据暂时不可用" }, 503);
  }
});
