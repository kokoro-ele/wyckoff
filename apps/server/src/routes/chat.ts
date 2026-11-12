import { workspaceContext } from "../cloud/context.js";
import { beginWorkspaceUsage } from "../billing/workspace.js";
import { billingErrorResponse } from "../billing/catalog.js";
import { chatRequestSchema } from "@wyckoff/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { bodyLimit } from "hono/body-limit";
import { runAgent } from "../agent/run.js";
import { hasLlmConfiguration } from "../config.js";

export const chatRoutes = new Hono();

chatRoutes.get("/status", (c) => c.json({ configured: hasLlmConfiguration() }));

chatRoutes.post("/", bodyLimit({ maxSize: 1024 * 1024 }), async (c) => {
  const parsed = chatRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
  }

  let lease;
  try { lease = await beginWorkspaceUsage(c.req.header("Idempotency-Key")); }
  catch (error) { const result = billingErrorResponse(error); return c.json(result.body, result.status); }
  return streamSSE(c, async (stream) => {
    let succeeded = false;
    try {
      for await (const event of runAgent(parsed.data)) {
        if (event.type === "done") {
          succeeded = true;
          workspaceContext.getStore()?.state.set("chatDone", event);
          continue;
        }
        if (event.type === "error") { succeeded = false; workspaceContext.getStore()?.state.delete("chatDone"); }
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
      if (succeeded) await lease.complete();
    } catch (error) {
      workspaceContext.getStore()?.state.delete("chatDone");
      console.error("[chat] 流式输出中断：", error instanceof Error ? error.message : "unknown error");
      await stream.writeSSE({
        data: JSON.stringify({ type: "error", message: (error as Error).message || "对话中断" }),
      });
    } finally { await lease.release(); }
  });
});
