import { workspaceContext } from "../cloud/context.js";
import OpenAI from "openai";
import { config } from "../config.js";

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
    let scoped = context.state.get("openai-client") as OpenAI | undefined;
    if (!scoped) {
      const remaining = Math.max(1_000, context.deadline - Date.now());
      scoped = new OpenAI({
        apiKey: config.llm.apiKey,
        baseURL: config.llm.baseUrl,
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
      context.state.set("openai-client", scoped);
    }
    return scoped;
  }

  return (client ??= new OpenAI({ apiKey: config.llm.apiKey, baseURL: config.llm.baseUrl }));
}
