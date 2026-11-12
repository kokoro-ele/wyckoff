import { config } from "../config.js";
import { getState } from "../db/index.js";

export const LLM_STATE_KEYS = {
  apiKey: "llm.apiKey",
  baseUrl: "llm.baseUrl",
  model: "llm.model",
  mode: "llm.mode",
} as const;

export interface ResolvedLlmSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  webSearch: boolean;
  source: "user" | "operator" | "none";
}

export function readCustomLlmSettings(): { apiKey: string; baseUrl: string; model: string; mode: "operator" | "custom" } {
  const read = (key: string) => {
    try {
      return getState(key)?.trim() ?? "";
    } catch {
      // Keep health checks and local tooling working outside a workspace.
      return "";
    }
  };
  const apiKey = read(LLM_STATE_KEYS.apiKey);
  const storedMode = read(LLM_STATE_KEYS.mode);
  return {
    apiKey,
    baseUrl: read(LLM_STATE_KEYS.baseUrl),
    model: read(LLM_STATE_KEYS.model),
    mode: storedMode === "operator" ? "operator" : storedMode === "custom" ? "custom" : apiKey ? "custom" : "operator",
  };
}

/**
 * Per-user settings take priority. They live inside the encrypted workspace,
 * never in Postgres app tables and never in the public response.
 */
export function resolveLlmSettings(): ResolvedLlmSettings {
  const custom = readCustomLlmSettings();
  const useCustom = custom.mode === "custom" && custom.apiKey;
  if (useCustom) {
    return {
      apiKey: custom.apiKey,
      baseUrl: custom.baseUrl || config.llm.baseUrl,
      model: custom.model || config.llm.model,
      webSearch: false,
      source: "user",
    };
  }
  return {
    apiKey: config.llm.apiKey,
    baseUrl: config.llm.baseUrl,
    model: config.llm.model,
    webSearch: config.llm.webSearch,
    source: config.llm.apiKey ? "operator" : "none",
  };
}
