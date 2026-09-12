import {
  type RuntimeSettingsResponse,
  updateLlmSettingsRequestSchema,
} from "@wyckoff/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getRuntimeSettings, updateLlmSettings } from "../config.js";

export const settingsRoutes = new Hono();

settingsRoutes.get("/", (c) => c.json<RuntimeSettingsResponse>(getRuntimeSettings()));

settingsRoutes.put(
  "/llm",
  bodyLimit({
    maxSize: 16 * 1024,
    onError: (c) => c.json({ code: "PAYLOAD_TOO_LARGE", message: "设置内容不能超过 16 KiB" }, 413),
  }),
  async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ code: "BAD_REQUEST", message: "请求体必须是 JSON" }, 400);
    }

    const parsed = updateLlmSettingsRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ code: "BAD_REQUEST", message: parsed.error.issues[0]?.message ?? "参数错误" }, 400);
    }

    try {
      return c.json<RuntimeSettingsResponse>(updateLlmSettings(parsed.data));
    } catch {
      // 不打印异常对象或请求体，确保凭据不会经错误日志泄漏。
      console.error("[settings] 保存 LLM 设置失败");
      return c.json({ code: "SETTINGS_SAVE_FAILED", message: "设置保存失败" }, 500);
    }
  },
);
