import OpenAI from "openai";
import { config, llmConnectionRevision } from "../config.js";

let client: OpenAI | null = null;
let clientRevision = -1;

/**
 * 连接凭据不变时复用客户端；Key 或 Base URL 热更新后，下次调用自动重建。
 */
export function getOpenAiClient(): OpenAI {
  if (!client || clientRevision !== llmConnectionRevision) {
    client = new OpenAI({ apiKey: config.llm.apiKey, baseURL: config.llm.baseUrl });
    clientRevision = llmConnectionRevision;
  }
  return client;
}
