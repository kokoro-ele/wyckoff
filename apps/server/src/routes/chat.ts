import { workspaceContext } from "../cloud/context.js";
import { beginWorkspaceUsage } from "../billing/workspace.js";
import { billingErrorResponse } from "../billing/catalog.js";
import { chatRequestSchema } from "@wyckoff/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { bodyLimit } from "hono/body-limit";
import { runAgent } from "../agent/run.js";
import { detectIntent, planForIntent } from "../agent/intent.js";
import { hasLlmConfiguration } from "../config.js";
import { resolveLlmSettings } from "../llm/settings.js";
import { getPool } from "../cloud/postgres.js";
import { hasEntitlement } from "../billing/entitlements.js";
import * as agentMemory from "../services/agentMemory.js";
import { listInterruptedRuns } from "../services/agentRuns.js";

export const chatRoutes = new Hono();

chatRoutes.get("/status", (c) => c.json({ configured: hasLlmConfiguration() }));

chatRoutes.get("/memory", async (c) => {
  const symbol = c.req.query("symbol");
  const period = c.req.query("period") ?? "1d";
  if (!symbol) return c.json({ code: "BAD_REQUEST", message: "缺少 symbol" }, 400);
  const snapshot = agentMemory.getSnapshot(symbol, period);
  const userId = workspaceContext.getStore()?.userId;
  if (userId) {
    const interrupted = await listInterruptedRuns(userId, symbol, period).catch(() => []);
    const known = new Set(snapshot.open.map((entry) => entry.content));
    const merged = interrupted.filter((entry) => !known.has(entry.content));
    if (merged.length > 0) {
      snapshot.open = [...merged, ...snapshot.open].slice(0, 4);
      if (!snapshot.focus) snapshot.focus = { ...merged[0], kind: "focus" };
    }
  }
  return c.json(snapshot);
});

chatRoutes.post("/interrupt", bodyLimit({ maxSize: 64 * 1024 }), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    symbol?: unknown;
    period?: unknown;
    sessionId?: unknown;
    question?: unknown;
  };
  const symbol = typeof body.symbol === "string" ? body.symbol : "";
  const period = typeof body.period === "string" ? body.period : "1d";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
  if (!symbol || !question) return c.json({ code: "BAD_REQUEST", message: "缺少 symbol 或 question" }, 400);
  const language = c.req.query("language") === "en" ? "en" : "zh";
  const intent = detectIntent(question);
  const steps = planForIntent(intent, language);
  agentMemory.rememberFocus({ symbol, period, sessionId, question, intent, steps });
  agentMemory.rememberOpen({ symbol, period, sessionId, content: question });
  return c.json({ ok: true, memory: agentMemory.getSnapshot(symbol, period) });
});

chatRoutes.post("/", bodyLimit({ maxSize: 1024 * 1024 }), async (c) => {
  const parsed = chatRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
  }

  // A user-supplied model is paid for by the user directly, so it must not
  // consume platform analysis credits. It requires an active BYOK entitlement.
  const llm = resolveLlmSettings();
  const usesOwnModel = llm.source === "user";
  if (usesOwnModel) {
    const userId = workspaceContext.getStore()?.userId;
    if (!userId || !(await hasEntitlement(getPool(), userId, "byok"))) {
      return c.json({ code: "BYOK_REQUIRED", message: "使用自己的模型需要先开通 BYOK" }, 403);
    }
  }
  const context = workspaceContext.getStore();
  const cancelSignal = context?.state.get("cancelSignal") as AbortSignal | undefined;
  if (context) context.signal = cancelSignal ? AbortSignal.any([c.req.raw.signal, cancelSignal]) : c.req.raw.signal;
  let lease: Awaited<ReturnType<typeof beginWorkspaceUsage>> | null = null;
  if (!usesOwnModel) {
    try { lease = await beginWorkspaceUsage(c.req.header("Idempotency-Key")); }
    catch (error) { const result = billingErrorResponse(error); return c.json(result.body, result.status); }
  }
  const runId = c.req.header("Idempotency-Key") || undefined;
  console.log("[agent] chat run id", runId);
  return streamSSE(c, async (stream) => {
    let succeeded = false;
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    try {
      for await (const event of runAgent(parsed.data, context?.signal, runId)) {
        if (event.type === "usage") {
          usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
          continue;
        }
        if (event.type === "done") {
          succeeded = true;
          workspaceContext.getStore()?.state.set("chatDone", event);
          continue;
        }
        if (event.type === "error") { succeeded = false; workspaceContext.getStore()?.state.delete("chatDone"); }
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
      if (succeeded && lease) await lease.complete(usage);
    } catch (error) {
      workspaceContext.getStore()?.state.delete("chatDone");
      console.error("[chat] 流式输出中断：", error instanceof Error ? error.message : "unknown error");
      await stream.writeSSE({
        data: JSON.stringify({ type: "error", message: (error as Error).message || "对话中断" }),
      });
    } finally { if (lease) await lease.release(); }
  });
});
