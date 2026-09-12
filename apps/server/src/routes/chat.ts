import { chatRequestSchema } from "@wyckoff/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { runAgent } from "../agent/run.js";
import { isLlmConfigured } from "../config.js";

export const chatRoutes = new Hono();

chatRoutes.get("/status", (c) => c.json({ configured: isLlmConfigured }));

chatRoutes.post("/", async (c) => {
  const parsed = chatRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
  }

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of runAgent(parsed.data)) {
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
    } catch (error) {
      console.error("[chat] 流式输出中断：", error);
      await stream.writeSSE({
        data: JSON.stringify({ type: "error", message: (error as Error).message || "对话中断" }),
      });
    }
  });
});
