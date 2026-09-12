import { config } from "../config.js";
import { getOpenAiClient } from "./client.js";

export interface JsonCompletionMetadata {
  responseId: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export async function completeJson(options: {
  instructions: string;
  input: string;
  webSearch?: boolean;
  /** 依赖实时信息的任务不可静默退化成模型记忆。 */
  requireWebSearch?: boolean;
  /** 审计用途；不改变原有只返回正文的调用协议。 */
  onComplete?: (metadata: JsonCompletionMetadata) => void;
}): Promise<string> {
  const useSearch = options.webSearch !== false && config.llm.webSearch;
  try {
    const result = await callResponses(options.instructions, options.input, useSearch);
    options.onComplete?.(result.metadata);
    return result.text;
  } catch (error) {
    if (useSearch) {
      if (options.requireWebSearch) throw error;
      console.warn("[llm] web_search 失败，改为无搜索重试：", (error as Error).message);
      const result = await callResponses(options.instructions, options.input, false);
      options.onComplete?.(result.metadata);
      return result.text;
    }
    throw error;
  }
}

async function callResponses(
  instructions: string,
  input: string,
  webSearch: boolean,
): Promise<{ text: string; metadata: JsonCompletionMetadata }> {
  const response = await getOpenAiClient().responses.create({
    model: config.llm.model,
    instructions,
    input,
    tools: webSearch
      ? [
          {
            type: "web_search",
            search_context_size: "medium",
            user_location: { country: "US", timezone: "America/New_York", city: "New York" },
          },
        ]
      : undefined,
    store: false,
  });
  return {
    text: response.output_text ?? "",
    metadata: {
      responseId: response.id,
      model: response.model,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      totalTokens: response.usage?.total_tokens ?? null,
    },
  };
}

export function extractJson<T>(text: string): T {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fence?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回 JSON");
  return JSON.parse(raw.slice(start, end + 1)) as T;
}
