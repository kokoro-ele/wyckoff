import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  RuntimeLlmSettings,
  RuntimeSettingsResponse,
  RuntimeSettingsSource,
  UpdateLlmSettingsRequest,
} from "@wyckoff/shared";
import {
  loadRuntimeSettings,
  saveRuntimeSettings,
  type PersistedLlmSettings,
  type RuntimeSettingsFile,
} from "./services/runtimeSettings.js";

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

const dataDir = path.resolve(repoRoot, env("DATA_DIR", "./data"));
mkdirSync(dataDir, { recursive: true });

const environmentLlm = {
  baseUrl: normalizeBaseUrl(env("OPENAI_BASE_URL", "https://api.openai.com/v1")),
  apiKey: env("OPENAI_API_KEY"),
  model: env("OPENAI_MODEL", "gpt-4o"),
  webSearch: envFlag("OPENAI_WEB_SEARCH", true),
};

const runtimeSettingsPath = path.join(dataDir, "runtime-settings.json");
let runtimeSettings: RuntimeSettingsFile;
try {
  runtimeSettings = loadRuntimeSettings(runtimeSettingsPath);
} catch {
  // 不输出解析内容或异常对象，避免未来的错误信息意外携带敏感字段。
  console.warn("[server] runtime-settings.json 无法读取，已回退到环境变量");
  runtimeSettings = { version: 1 };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveLlm(local: PersistedLlmSettings | undefined) {
  return {
    baseUrl: normalizeBaseUrl(local?.baseUrl ?? environmentLlm.baseUrl),
    apiKey: local?.apiKey ?? environmentLlm.apiKey,
    model: local?.model ?? environmentLlm.model,
    /** OpenAI Responses 内置 web_search。仅 Chat Completions 的网关请设为 0。 */
    webSearch: local?.webSearch ?? environmentLlm.webSearch,
  };
}

export const config = {
  port: Number(env("PORT", "8787")),
  dataDir,
  dbPath: path.join(dataDir, "wyckoff.db"),
  tickflow: {
    baseUrl: env("TICKFLOW_BASE_URL", "https://free-api.tickflow.org").replace(/\/+$/, ""),
    apiKey: env("TICKFLOW_API_KEY"),
  },
  llm: resolveLlm(runtimeSettings.llm),
  recommend: {
    enabled: envFlag("RECOMMEND_ENABLED", true),
    /** America/New_York 的触发时刻，默认美股收盘后。 */
    hour: Number(env("RECOMMEND_HOUR", "16")),
    minute: Number(env("RECOMMEND_MINUTE", "30")),
    timezone: env("RECOMMEND_TZ", "America/New_York"),
    bookCap: Number(env("RECOMMEND_BOOK_CAP", "25")),
    candidateCount: Number(env("RECOMMEND_CANDIDATES", "10")),
    concurrency: Math.max(1, Number(env("RECOMMEND_CONCURRENCY", "3")) || 3),
  },
  mail: {
    host: env("SMTP_HOST"),
    port: Number(env("SMTP_PORT", "587")),
    user: env("SMTP_USER"),
    pass: env("SMTP_PASS"),
    from: env("SMTP_FROM"),
    to: env("MAIL_TO"),
  },
};

/** 未配置 API Key 即视为免费档，只有日线及以上周期可用。 */
export const isFreeTier = config.tickflow.apiKey === "";
/** live binding：页面保存或移除 Key 后，同一进程内的路由立即看到新状态。 */
export let isLlmConfigured = config.llm.apiKey !== "";
/** 仅连接凭据变化时递增，供 OpenAI client 安全失效缓存。 */
export let llmConnectionRevision = 0;

function llmSettingsSource(): RuntimeSettingsSource {
  if (runtimeSettings.llm?.apiKey) return "local";
  if (environmentLlm.apiKey) return "environment";
  return "none";
}

function publicLlmSettings(): RuntimeLlmSettings {
  return {
    configured: isLlmConfigured,
    source: llmSettingsSource(),
    baseUrl: config.llm.baseUrl,
    model: config.llm.model,
    webSearch: config.llm.webSearch,
  };
}

/** 只返回可公开字段，API Key 永远不会离开服务端。 */
export function getRuntimeSettings(): RuntimeSettingsResponse {
  return { llm: publicLlmSettings() };
}

/**
 * 持久化页面配置并热更新当前进程。
 * apiKey 为空或缺省时保留；removeLocalKey 仅删除页面值并回退环境变量。
 */
export function updateLlmSettings(update: UpdateLlmSettingsRequest): RuntimeSettingsResponse {
  const nextLlm: PersistedLlmSettings = { ...runtimeSettings.llm };
  const apiKey = update.apiKey?.trim();

  if (update.removeLocalKey) delete nextLlm.apiKey;
  else if (apiKey) nextLlm.apiKey = apiKey;

  if (update.baseUrl !== undefined) nextLlm.baseUrl = normalizeBaseUrl(update.baseUrl);
  if (update.model !== undefined) nextLlm.model = update.model;
  if (update.webSearch !== undefined) nextLlm.webSearch = update.webSearch;

  const nextSettings: RuntimeSettingsFile = {
    version: 1,
    ...(Object.keys(nextLlm).length > 0 ? { llm: nextLlm } : {}),
  };

  // 先持久化，成功后再切换内存态；写盘失败不会留下“看似已保存”的配置。
  saveRuntimeSettings(runtimeSettingsPath, nextSettings);
  const previousApiKey = config.llm.apiKey;
  const previousBaseUrl = config.llm.baseUrl;
  runtimeSettings = nextSettings;
  Object.assign(config.llm, resolveLlm(runtimeSettings.llm));
  isLlmConfigured = config.llm.apiKey !== "";
  if (config.llm.apiKey !== previousApiKey || config.llm.baseUrl !== previousBaseUrl) {
    llmConnectionRevision += 1;
  }

  return getRuntimeSettings();
}
