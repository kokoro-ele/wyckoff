import { backtestRequestSchema } from "@wyckoff/shared";
import { BacktestInputError, runBacktest } from "@wyckoff/wyckoff";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { getKlines, MarketDataError } from "../services/market.js";
import * as store from "../services/backtests.js";

export const backtestRoutes = new Hono();

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const idSchema = z.string().min(1).max(128);
const symbolSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/, "标的代码格式无效");
const MAX_BACKTEST_BARS = 50_000;

/**
 * 回测是纯本地、确定性计算：先从共用行情缓存读取完整历史，以免请求区间开始处
 * 缺少指标预热数据；引擎再依据 request.startTime/endTime 截取实际评估区间。
 */
backtestRoutes.post(
  "/run",
  bodyLimit({
    maxSize: 32 * 1024,
    onError: (c) => c.json({ code: "PAYLOAD_TOO_LARGE", message: "回测参数不能超过 32 KiB" }, 413),
  }),
  async (c) => {
    const parsed = backtestRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
    }
    const symbol = symbolSchema.safeParse(parsed.data.symbol);
    if (!symbol.success) {
      return c.json({ code: "BAD_REQUEST", message: symbol.error.issues[0]?.message ?? "标的代码格式无效" }, 400);
    }

    try {
      const request = { ...parsed.data, symbol: parsed.data.symbol.toUpperCase() };
      const klines = await getKlines({
        symbol: request.symbol,
        period: request.period,
        adjust: request.adjust,
      });
      if (klines.length > MAX_BACKTEST_BARS) {
        return c.json(
          {
            code: "DATASET_TOO_LARGE",
            message: `当前历史包含 ${klines.length} 根 K 线，单次回测最多支持 ${MAX_BACKTEST_BARS} 根`,
          },
          422,
        );
      }
      const result = runBacktest({ request, klines, dataSource: "TickFlow" });
      store.saveBacktest(result);
      return c.json({ result });
    } catch (error) {
      return errorResponse(c, error);
    }
  },
);

backtestRoutes.get("/", (c) => {
  const parsed = historyQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
  }
  return c.json({ runs: store.listBacktests(parsed.data.limit) });
});

backtestRoutes.get("/:id", (c) => {
  const parsed = idSchema.safeParse(c.req.param("id"));
  if (!parsed.success) return c.json({ code: "BAD_REQUEST", message: "回测 ID 无效" }, 400);

  const result = store.getBacktest(parsed.data);
  if (!result) return c.json({ code: "NOT_FOUND", message: "回测记录不存在" }, 404);
  return c.json({ result });
});

backtestRoutes.delete("/:id", (c) => {
  const parsed = idSchema.safeParse(c.req.param("id"));
  if (!parsed.success) return c.json({ code: "BAD_REQUEST", message: "回测 ID 无效" }, 400);
  if (!store.deleteBacktest(parsed.data)) {
    return c.json({ code: "NOT_FOUND", message: "回测记录不存在" }, 404);
  }
  return c.json({ ok: true });
});

function errorResponse(c: Context, error: unknown): Response {
  if (error instanceof MarketDataError) {
    return c.json({ code: error.code, message: error.message }, error.status as 400 | 403 | 404 | 500);
  }
  if (error instanceof BacktestInputError) {
    const status = error.code === "INVALID_REQUEST" ? 400 : 422;
    return c.json({ code: error.code, message: error.message }, status);
  }
  console.error("[backtest] 运行失败：", error);
  return c.json({ code: "INTERNAL", message: "回测运行失败" }, 500);
}
