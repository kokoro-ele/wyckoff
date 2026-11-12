import { workspaceContext } from "../cloud/context.js";
import OpenAI from "openai";
import { config } from "../config.js";
import { resolveLlmSettings } from "./settings.js";

let client: OpenAI | undefined;

/**
 * Returns an OpenAI client bound to the operator's credentials.
 * Cloud requests get a per-request client with a hard deadline; tests and
 * local tooling share a single client.
 */
export function getOpenAiClient(): OpenAI {
  const context = workspaceContext.getStore();
  if (context) {
    if (Date.now() > context.deadline) throw new Error("任务超过云端执行时限，请稍后重试");
    const settings = resolveLlmSettings();
    if (!settings.apiKey) throw new Error("分析服务尚未配置，请先在设置里填写你自己的模型 Key");
    const cacheKey = `${settings.baseUrl}|${settings.model}|${settings.apiKey}`;
    const cached = context.state.get("openai-client") as { key: string; client: OpenAI } | undefined;
    if (cached?.key === cacheKey) return cached.client;
    const remaining = Math.max(1_000, context.deadline - Date.now());
    const scoped = new OpenAI({
      apiKey: settings.apiKey,
      baseURL: settings.baseUrl,
      timeout: Math.min(45_000, remaining),
      maxRetries: 0,
      fetch: (url, init) =>
        fetch(url, {
          ...init,
          signal: AbortSignal.any([
            AbortSignal.timeout(Math.max(1, context.deadline - Date.now())),
            ...(init?.signal ? [init.signal] : []),
          ]),
        }),
    });
    context.state.set("openai-client", { key: cacheKey, client: scoped });
    return scoped;
  }

  return (client ??= new OpenAI({ apiKey: config.llm.apiKey, baseURL: config.llm.baseUrl }));
}
