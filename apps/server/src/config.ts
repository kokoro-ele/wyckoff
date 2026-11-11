import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function envFlag(name: string, defaultOn: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return defaultOn;
  return !["0", "false", "off", "no"].includes(value);
}

const dataDir = path.resolve(repoRoot, env("DATA_DIR", process.env.VERCEL ? "/tmp/wyckoff" : "./data"));
mkdirSync(dataDir, { recursive: true });

const environmentLlm = {
  baseUrl: normalizeBaseUrl(env("OPENAI_BASE_URL", "https://api.openai.com/v1")),
  apiKey: env("OPENAI_API_KEY"),
  model: env("OPENAI_MODEL", "gpt-4o"),
  webSearch: envFlag("OPENAI_WEB_SEARCH", true),
};

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export const config = {
  port: Number(env("PORT", "8787")),
  dataDir,
  dbPath: path.join(dataDir, "wyckoff.db"),
  tickflow: {
    baseUrl: env("TICKFLOW_BASE_URL", "https://free-api.tickflow.org").replace(/\/+$/, ""),
    apiKey: env("TICKFLOW_API_KEY"),
  },
  get llm() {
    return environmentLlm;
  },
};

/** 未配置 API Key 即视为免费档，只有日线及以上周期可用。 */
export const isFreeTier = config.tickflow.apiKey === "";

/** Operator-only model credentials; user workspaces can no longer override these. */
export function hasLlmConfiguration(): boolean {
  return environmentLlm.apiKey !== "";
}
