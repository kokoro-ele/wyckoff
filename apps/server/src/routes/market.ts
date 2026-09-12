import { klineQuerySchema } from "@wyckoff/shared";
import { renderFeatureSummary } from "@wyckoff/wyckoff";
import { type Context, Hono } from "hono";
import { isFreeTier } from "../config.js";
import { getInstrument } from "../services/instruments.js";
import { getFeatures, getKlines, MarketDataError } from "../services/market.js";

export const marketRoutes = new Hono();

marketRoutes.get("/klines", async (c) => {
  const parsed = klineQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
  }

  try {
    const klines = await getKlines(parsed.data);
    return c.json({ ...parsed.data, klines });
  } catch (error) {
    return errorResponse(c, error);
  }
});

marketRoutes.get("/features", async (c) => {
  const parsed = klineQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
  }

  try {
    const features = await getFeatures(parsed.data);
    return c.json({ features, summary: renderFeatureSummary(features) });
  } catch (error) {
    return errorResponse(c, error);
  }
});

marketRoutes.get("/instrument/:symbol", async (c) => {
  const instrument = await getInstrument(c.req.param("symbol"));
  if (!instrument) return c.json({ code: "NOT_FOUND", message: "未找到该标的" }, 404);
  return c.json({ instrument });
});

marketRoutes.get("/capabilities", (c) =>
  c.json({
    freeTier: isFreeTier,
    note: isFreeTier
      ? "当前为 TickFlow 免费服务，仅提供日线及以上周期的历史数据，不含分钟线与实时行情。"
      : "已配置 TickFlow API Key，可使用完整服务。",
  }),
);

function errorResponse(c: Context, error: unknown): Response {
  if (error instanceof MarketDataError) {
    return c.json({ code: error.code, message: error.message }, error.status as 400 | 403 | 404 | 500);
  }
  console.error("[market] 未预期的错误：", error);
  return c.json({ code: "INTERNAL", message: (error as Error).message ?? "服务内部错误" }, 500);
}
