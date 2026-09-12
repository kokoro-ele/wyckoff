import {
  aiWyckoffBacktestRequestSchema,
  type AiWyckoffBacktestDetailResponse,
  type AiWyckoffBacktestHistoryResponse,
  type AiWyckoffBacktestStartResponse,
} from "@wyckoff/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { isLlmConfigured } from "../config.js";
import { queueAiWyckoffBacktest } from "../jobs/aiBacktest.js";
import {
  deleteAiBacktestRun,
  getAiBacktestRun,
  getAiWyckoffResult,
  listAiBacktestCalls,
  listAiBacktestRuns,
  toAiWyckoffRunSummary,
} from "../services/aiBacktests.js";

export const aiBacktestRoutes = new Hono();

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, "运行 ID 无效");
const symbolSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/, "标的代码格式无效");

aiBacktestRoutes.post(
  "/run",
  bodyLimit({
    maxSize: 32 * 1024,
    onError: (c) => c.json({ code: "PAYLOAD_TOO_LARGE", message: "回测参数不能超过 32 KiB" }, 413),
  }),
  async (c) => {
    if (!isLlmConfigured) return c.json({ code: "NO_LLM", message: "未配置 OPENAI_API_KEY" }, 400);
    const parsed = aiWyckoffBacktestRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
    }
    const symbol = symbolSchema.safeParse(parsed.data.symbol);
    if (!symbol.success) {
      return c.json({ code: "BAD_REQUEST", message: symbol.error.issues[0]?.message ?? "标的代码格式无效" }, 400);
    }

    const started = queueAiWyckoffBacktest({ ...parsed.data, symbol: parsed.data.symbol.toUpperCase() });
    if (!started) return c.json({ code: "BUSY", message: "已有 AI Wyckoff 回测正在运行" }, 409);
    return c.json<AiWyckoffBacktestStartResponse>(started, 202);
  },
);

aiBacktestRoutes.get("/", (c) => {
  const parsed = historyQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
  }
  const response: AiWyckoffBacktestHistoryResponse = {
    runs: listAiBacktestRuns(parsed.data.limit).map(toAiWyckoffRunSummary),
  };
  return c.json(response);
});

aiBacktestRoutes.get("/:id/calls", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ code: "BAD_REQUEST", message: "运行 ID 无效" }, 400);
  if (!getAiBacktestRun(id)) return c.json({ code: "NOT_FOUND", message: "AI Wyckoff 回测不存在" }, 404);

  // asOfTime 仅供内部撮合映射；审计接口仍坚持用匿名 BAR 下标表达时序。
  const calls = listAiBacktestCalls(id).map(({ asOfTime: _asOfTime, ...call }) => call);
  return c.json({ calls });
});

aiBacktestRoutes.get("/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ code: "BAD_REQUEST", message: "运行 ID 无效" }, 400);
  const stored = getAiBacktestRun(id);
  if (!stored) return c.json({ code: "NOT_FOUND", message: "AI Wyckoff 回测不存在" }, 404);

  const result = getAiWyckoffResult(stored);
  const response: AiWyckoffBacktestDetailResponse = {
    run: toAiWyckoffRunSummary(stored),
    ...(result ? { result } : {}),
  };
  return c.json(response);
});

aiBacktestRoutes.delete("/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ code: "BAD_REQUEST", message: "运行 ID 无效" }, 400);
  const deleted = deleteAiBacktestRun(id);
  if (deleted === "not_found") return c.json({ code: "NOT_FOUND", message: "AI Wyckoff 回测不存在" }, 404);
  if (deleted === "not_terminal") {
    return c.json({ code: "RUNNING", message: "运行中的回测不能删除" }, 409);
  }
  return c.json({ ok: true });
});

function parseId(value: string): string | null {
  const parsed = idSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
