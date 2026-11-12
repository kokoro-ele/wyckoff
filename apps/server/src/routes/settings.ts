import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { config } from "../config.js";
import { setState } from "../db/index.js";
import { getPool } from "../cloud/postgres.js";
import { workspaceContext } from "../cloud/context.js";
import { hasEntitlement } from "../billing/entitlements.js";
import {
  LLM_STATE_KEYS,
  readCustomLlmSettings,
  resolveLlmSettings,
} from "../llm/settings.js";

export const settingsRoutes = new Hono();

function fail(message: string) {
  return { code: "INVALID_LLM_SETTINGS", message };
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Base URL 不是合法 URL");
  }
  if (url.protocol !== "https:") throw new Error("Base URL 必须使用 HTTPS");
  if (url.username || url.password) throw new Error("Base URL 不能包含账号信息");
  const host = url.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("[fc") ||
    host.startsWith("[fd") ||
    host.startsWith("[fe80") ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) throw new Error("Base URL 不能指向本地或内网地址");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function normalizeModel(value: string): string {
  const model = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(model)) {
    throw new Error("模型名不合法");
  }
  return model;
}

function normalizeApiKey(value: string): string {
  const key = value.trim();
  if (key.length < 8 || key.length > 512 || /[\r\n]/.test(key)) {
    throw new Error("API Key 不合法");
  }
  return key;
}

function publicSettings() {
  const custom = readCustomLlmSettings();
  const effective = resolveLlmSettings();
  return {
    configured: Boolean(effective.apiKey),
    source: effective.source,
    mode: custom.mode,
    baseUrl: effective.baseUrl,
    model: effective.model,
    custom: Boolean(custom.apiKey),
    operatorConfigured: Boolean(config.llm.apiKey),
  };
}

settingsRoutes.get("/llm", async (c) => {
  const userId = workspaceContext.getStore()?.userId;
  const byokEntitled = userId ? await hasEntitlement(getPool(), userId, "byok") : false;
  const value = publicSettings();
  return c.json({ ...value, configured: value.source === "user" && !byokEntitled ? false : value.configured, byokEntitled });
});

settingsRoutes.put(
  "/llm",
  bodyLimit({ maxSize: 32 * 1024, onError: (c) => c.json(fail("请求体过大"), 413) }),
  async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { mode?: unknown; apiKey?: unknown; baseUrl?: unknown; model?: unknown }
      | null;
    if (!body || typeof body !== "object") return c.json(fail("参数错误"), 400);
    const existing = readCustomLlmSettings();
    const mode = body.mode === "custom" ? "custom" : "operator";
    const userId = workspaceContext.getStore()?.userId;
    if (mode === "custom" && (!userId || !(await hasEntitlement(getPool(), userId, "byok")))) {
      return c.json({ code: "BYOK_REQUIRED", message: "使用自己的模型需要先开通 BYOK" }, 403);
    }
    try {
      setState(LLM_STATE_KEYS.mode, mode);
      if (mode === "custom") {
        const apiKey =
          typeof body.apiKey === "string" && body.apiKey.trim()
            ? normalizeApiKey(body.apiKey)
            : existing.apiKey;
        if (!apiKey) throw new Error("请填写 API Key");
        const baseUrl = normalizeBaseUrl(
          typeof body.baseUrl === "string" && body.baseUrl.trim()
            ? body.baseUrl
            : existing.baseUrl || "https://api.openai.com/v1",
        );
        const model = normalizeModel(
          typeof body.model === "string" && body.model.trim()
            ? body.model
            : existing.model || config.llm.model,
        );
        // Stored inside the AES-encrypted per-user workspace.
        setState(LLM_STATE_KEYS.apiKey, apiKey);
        setState(LLM_STATE_KEYS.baseUrl, baseUrl);
        setState(LLM_STATE_KEYS.model, model);
      }
      return c.json(publicSettings());
    } catch (error) {
      return c.json(fail(error instanceof Error ? error.message : "设置无效"), 400);
    }
  },
);

settingsRoutes.delete("/llm", (c) => {
  setState(LLM_STATE_KEYS.apiKey, "");
  setState(LLM_STATE_KEYS.baseUrl, "");
  setState(LLM_STATE_KEYS.model, "");
  setState(LLM_STATE_KEYS.mode, "operator");
  return c.json(publicSettings());
});
