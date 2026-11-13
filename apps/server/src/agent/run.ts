import {
  type AgentEvent,
  type AnalysisMode,
  type ChatMessage,
  type ChatRequest,
  type Kline,
  makeId,
  PERIOD_LABELS,
} from "@wyckoff/shared";
import { formatBarTime, summarizeSelectedBar, summarizeSelectedRange } from "@wyckoff/wyckoff";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type {
  Response as OpenAIResponse,
  ResponseFunctionToolCall,
  ResponseFunctionWebSearch,
  ResponseInputItem,
  ResponseStreamEvent,
} from "openai/resources/responses/responses";
import { workspaceContext } from "../cloud/context.js";
import { getOpenAiClient } from "../llm/client.js";
import { resolveLlmSettings, type ResolvedLlmSettings } from "../llm/settings.js";
import { listAnnotations } from "../services/annotations.js";
import { getInstrument } from "../services/instruments.js";
import { getKlines } from "../services/market.js";
import * as sessions from "../services/sessions.js";
import * as agentMemory from "../services/agentMemory.js";
import { clearInterruptedRuns, isAgentRunCancelled, listInterruptedRuns } from "../services/agentRuns.js";
import { detectIntent, planForIntent } from "./intent.js";
import { buildSystemPrompt } from "./prompt.js";
import { executeTool, type RunContext, responseTools, toolDefinitionsForMode } from "./tools.js";

/** Agent 每轮最多来回调用几次本地工具，防止模型陷入循环。 */
const MAX_ITERATIONS = 10;
/** 带入上下文的历史消息条数。 */
const HISTORY_LIMIT = 20;

function logJson(label: string, payload: unknown): void {
  // Prompts and histories may contain private user research. Only emit them
  // when an operator explicitly enables diagnostics.
  if (process.env.DEBUG_LLM !== "1") return;
  console.log(`[llm] → ${label}\n${JSON.stringify(payload, null, 2)}`);
}

/**
 * 运行一轮 Agent 对话，以异步生成器的形式吐出事件，由路由层转成 SSE。
 *
 * 默认走 OpenAI Responses API，这样可以同时用内置 `web_search` 和本地画图工具。
 * 若当前网关没有 `/v1/responses`，再回退到 Chat Completions（无联网搜索）。
 */
export async function* runAgent(request: ChatRequest, requestSignal?: AbortSignal, runId?: string): AsyncGenerator<AgentEvent> {
  const llm = resolveLlmSettings();
  if (!llm.apiKey) {
    yield {
      type: "error",
      message: "分析服务尚未配置。请先在设置里填写你自己的模型 Key，或联系运营方。",
    };
    return;
  }

  const { sessionId, symbol, period, adjust, message, context, viewport } = request;
  const mode: AnalysisMode = request.mode ?? "agent";
  const showTrace = request.showTrace === true && process.env.ALLOW_AGENT_TRACE === "1";
  const language = request.language ?? "zh";
  sessions.ensureSession(sessionId, symbol, period);
  sessions.titleFromFirstMessage(sessionId, message);

  const userMessage: ChatMessage = {
    id: makeId("msg"),
    role: "user",
    content: message,
    mode,
    context,
    createdAt: Date.now(),
  };
  sessions.appendMessage(sessionId, userMessage);

  const runStartedAt = new Date();
  const runContext = workspaceContext.getStore();
  const interrupted = runContext?.userId
    ? await listInterruptedRuns(runContext.userId, symbol, period).catch(() => [])
    : [];
  const previousMemory = agentMemory.getSnapshot(symbol, period);
  if (interrupted.length > 0) {
    const known = new Set(previousMemory.open.map((entry) => entry.content));
    previousMemory.open = [...interrupted.filter((entry) => !known.has(entry.content)), ...previousMemory.open].slice(0, 4);
  }
  const resumeQuestion = agentMemory.isResumeMessage(message) && previousMemory.open[0]
    ? previousMemory.open[0].content
    : null;
  const question = resumeQuestion ?? message;
  const intent = detectIntent(question, context);
  const initialPlan = planForIntent(intent, language);
  if (agentMemory.looksLikeCorrection(message)) {
    agentMemory.rememberCorrection({ symbol, period, sessionId, content: message });
  }
  agentMemory.rememberFocus({ symbol, period, sessionId, question, intent, steps: initialPlan });
  const memory = agentMemory.getSnapshot(symbol, period);
  if (previousMemory.open.length > 0) {
    const known = new Set(memory.open.map((entry) => entry.content));
    memory.open = [...previousMemory.open.filter((entry) => !known.has(entry.content)), ...memory.open].slice(0, 4);
  }
  const memoryPrompt = agentMemory.formatMemoryPrompt(memory, language);

  let klinesPromise: Promise<Kline[]> | null = null;
  const ctx: RunContext = {
    symbol,
    period,
    adjust,
    language,
    sessionId,
    question,
    signal: requestSignal ?? runContext?.signal,
    viewport,
    klines: () => (klinesPromise ??= getKlines({ symbol, period, adjust })),
  };

  yield { type: "plan", question, intent, steps: initialPlan };

  const history = sessions
    .getMessages(sessionId)
    .filter((entry) => (entry.mode ?? "agent") === mode)
    .slice(-HISTORY_LIMIT - 1, -1);
  const situation = await buildSituationPrompt(ctx, viewport);
  const contextNote = await buildContextNote(ctx, context);
  const userContent = contextNote ? `${contextNote}\n\n${message}` : message;
  const languageRule =
    language === "en"
      ? "CRITICAL: Write the entire final answer in English, including headings and tables. Do not switch to Chinese."
      : "CRITICAL: 最终回答必须全部使用中文，包括标题和表格，不要切换成英文。";
  const instructions = [buildSystemPrompt(mode, language), languageRule, memoryPrompt, situation]
    .filter(Boolean)
    .join("\n\n");

  const toolTrace: NonNullable<ChatMessage["toolTrace"]> = [];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let answer = "";

  try {
    try {
      yield* visibleEvents(runResponsesLoop({
        ctx,
        history,
        userContent,
        instructions,
        mode,
        webSearch: llm.webSearch,
        llm,
        usage,
        toolTrace,
        onText: (delta) => {
          answer += delta;
        },
      }), showTrace, language);
    } catch (error) {
      if (llm.webSearch && isWebSearchUnsupported(error)) {
        console.warn("[agent] 当前模型/网关不支持 web_search，关闭联网后重试");
        yield* visibleEvents(runResponsesLoop({
          ctx,
          history,
          userContent,
          instructions,
          mode,
          webSearch: false,
          llm,
          usage,
          toolTrace,
          onText: (delta) => {
            answer += delta;
          },
        }), showTrace, language);
      } else if (isResponsesUnsupported(error)) {
        console.warn("[agent] Responses API 不可用，回退 Chat Completions（无联网搜索）：", (error as Error).message);
        yield* visibleEvents(runCompletionsLoop({
          ctx,
          history,
          userContent,
          instructions,
          mode,
          llm,
          usage,
          toolTrace,
          onText: (delta) => {
            answer += delta;
          },
        }), showTrace, language);
      } else {
        throw error;
      }
    }

    if (!answer.trim()) {
      throw new Error(
        language === "en"
          ? "The model returned no answer. Please retry."
          : "模型没有返回有效回答，请重试。",
      );
    }

    if (runContext?.state.get("clientGone") === true || await isAgentRunCancelled(runId)) {
      throw new Error("客户端已停止本次分析");
    }

    const totalTokens = usage.inputTokens + usage.outputTokens;
    if (totalTokens > 0) {
      yield { type: "usage", ...usage, totalTokens };
    }

    const assistantMessage: ChatMessage = {
      id: makeId("msg"),
      role: "assistant",
      content: answer,
      mode,
      toolTrace: toolTrace.length > 0
        ? toolTrace.map(({ name, summary, ok, durationMs }) => ({ name, summary, ok, durationMs }))
        : undefined,
      createdAt: Date.now(),
    };
    sessions.appendMessage(sessionId, assistantMessage);
    agentMemory.rememberConclusion({ symbol, period, sessionId, content: answer });
    agentMemory.resolveOpen(symbol, period);
    if (runContext?.userId) await clearInterruptedRuns(runContext.userId, symbol, period, runStartedAt);
    yield { type: "done", messageId: assistantMessage.id };
  } catch (error) {
    const cancelled = runId ? await isAgentRunCancelled(runId).catch(() => false) : false;
    const aborted = ctx.signal?.aborted || runContext?.state.get("clientGone") === true || cancelled || isAbortError(error);
    agentMemory.rememberOpen({
      symbol,
      period,
      sessionId,
      content: question,
    });
    if (answer.trim()) {
      sessions.appendMessage(sessionId, {
        id: makeId("msg"),
        role: "assistant",
        content: `${answer}\n\n${language === "en" ? "_Stopped before completion._" : "_分析在这里中止，尚未完成。_"}`,
        mode,
        interrupted: true,
        createdAt: Date.now(),
      });
    }
    if (aborted) {
      yield { type: "error", message: language === "en" ? "Analysis stopped. The unfinished question was saved." : "分析已停止，未完成的问题已保存。" };
      return;
    }
    console.error("[agent] 运行失败：", error instanceof Error ? error.message : "unknown error");
    yield { type: "error", message: (error as Error).message || "Agent 运行失败" };
  }
}

const PROGRESS_LABELS: Record<string, { zh: string; en: string }> = {
  web_search: { zh: "正在联网核实背景资料…", en: "Checking background sources…" },
  get_features: { zh: "正在读取交易区间与摆动点…", en: "Reading the trading range and swing points…" },
  get_klines: { zh: "正在核对关键 K 线的量价明细…", en: "Checking the price and volume of key bars…" },
  draw_annotations: { zh: "正在把结构标注到图上…", en: "Drawing the structure on the chart…" },
  clear_annotations: { zh: "正在清理旧标注…", en: "Clearing the previous annotations…" },
  update_annotation: { zh: "正在更新标注…", en: "Updating an annotation…" },
  focus_range: { zh: "正在聚焦相关区间…", en: "Focusing the relevant range…" },
  get_instrument_info: { zh: "正在核对标的资料…", en: "Checking the instrument details…" },
  set_research_focus: { zh: "正在明确研究问题与计划…", en: "Clarifying the question and plan…" },
  verify_annotations: { zh: "正在回读核对标注的日期与价格…", en: "Verifying annotation dates and prices…" },
  save_trade_plan: { zh: "正在保存交易计划…", en: "Saving the trade plan…" },
};

async function* visibleEvents(
  events: AsyncGenerator<AgentEvent>,
  showTrace: boolean,
  language: "zh" | "en",
): AsyncGenerator<AgentEvent> {
  for await (const event of events) {
    if (event.type === "tool_start") {
      const label = PROGRESS_LABELS[event.name]?.[language] ?? (language === "en" ? "Reading market data…" : "正在读取数据…");
      yield {
        type: "activity",
        id: event.id,
        kind: event.name === "verify_annotations" ? "verify" : "tool",
        label,
        status: "running",
      };
      if (showTrace) yield event;
      continue;
    }
    if (event.type === "tool_end") {
      yield {
        type: "activity",
        id: event.id,
        kind: event.name === "verify_annotations" ? "verify" : "tool",
        label: PROGRESS_LABELS[event.name]?.[language] ?? event.summary,
        status: event.ok ? "done" : "failed",
        detail: event.summary,
        durationMs: event.durationMs,
      };
      if (showTrace) yield event;
      continue;
    }
    yield event;
  }
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name;
  const message = (error as { message?: string }).message ?? "";
  return name === "AbortError" || /aborted|abort|取消|中止/i.test(message);
}

interface LoopArgs {
  ctx: RunContext;
  history: ChatMessage[];
  userContent: string;
  instructions: string;
  mode: AnalysisMode;
  llm: ResolvedLlmSettings;
  usage: { inputTokens: number; outputTokens: number };
  toolTrace: NonNullable<ChatMessage["toolTrace"]>;
  onText: (delta: string) => void;
}

async function* runResponsesLoop(args: LoopArgs & { webSearch: boolean }): AsyncGenerator<AgentEvent> {
  const { ctx, history, userContent, instructions, mode, webSearch, toolTrace, onText } = args;
  const input: ResponseInputItem[] = [
    ...history.map((m) => ({ role: m.role, content: m.content, type: "message" as const })),
    { role: "user", content: userContent, type: "message" },
  ];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    logJson(
      `model=${args.llm.model} responses iteration=${iteration + 1} web_search=${webSearch} items=${input.length}`,
      input,
    );

    const stream = await getOpenAiClient().responses.create({
      model: args.llm.model,
      instructions,
      input,
      tools: responseTools(webSearch, mode),
      include: webSearch ? ["web_search_call.action.sources"] : undefined,
      stream: true,
      store: false,
    });

    let completed: OpenAIResponse | null = null;
    const searchStarted = new Set<string>();
    const searchStartedAt = new Map<string, number>();

    for await (const event of stream) {
      for (const emitted of handleResponseEvent(event, { searchStarted, searchStartedAt, toolTrace, onText })) {
        yield emitted;
      }
      if (event.type === "response.completed" || event.type === "response.incomplete") {
        completed = event.response;
      }
      if (event.type === "response.failed") {
        throw new Error(event.response.error?.message ?? "Responses API 失败");
      }
    }

    if (!completed) throw new Error("Responses 流未返回完整结果");
    if (completed.usage) {
      args.usage.inputTokens += completed.usage.input_tokens ?? 0;
      args.usage.outputTokens += completed.usage.output_tokens ?? 0;
    }

    const calls = completed.output.filter((item): item is ResponseFunctionToolCall => item.type === "function_call");
    if (calls.length === 0) return;

    input.push(...(completed.output as ResponseInputItem[]));

    for (const call of calls) {
      const executed = await runLocalTool(call.call_id, call.name, call.arguments, ctx);
      for (const event of executed.events) yield event;
      toolTrace.push(executed.trace);
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: executed.content,
      });
    }
  }
}

function* handleResponseEvent(
  event: ResponseStreamEvent,
  state: {
    searchStarted: Set<string>;
    searchStartedAt: Map<string, number>;
    toolTrace: NonNullable<ChatMessage["toolTrace"]>;
    onText: (delta: string) => void;
  },
): Generator<AgentEvent> {
  switch (event.type) {
    case "response.output_text.delta":
      state.onText(event.delta);
      yield { type: "text", delta: event.delta };
      break;
    case "response.web_search_call.in_progress":
      state.searchStarted.add(event.item_id);
      state.searchStartedAt.set(event.item_id, Date.now());
      yield { type: "tool_start", id: event.item_id, name: "web_search", args: {} };
      break;
    case "response.output_item.done": {
      const item = event.item;
      if (item.type !== "web_search_call") break;
      if (!state.searchStarted.has(item.id)) {
        yield { type: "tool_start", id: item.id, name: "web_search", args: webSearchArgs(item) };
      }
      const durationMs = Date.now() - (state.searchStartedAt.get(item.id) ?? Date.now());
      const { summary, args, ok } = summarizeWebSearch(item);
      yield { type: "tool_end", id: item.id, name: "web_search", ok, summary, durationMs };
      state.toolTrace.push({ name: "web_search", summary, ok, args, durationMs });
      break;
    }
    default:
      break;
  }
}

async function* runCompletionsLoop(args: LoopArgs): AsyncGenerator<AgentEvent> {
  const { ctx, history, userContent, instructions, mode, toolTrace, onText } = args;
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: instructions },
    ...history.map((m) => ({ role: m.role, content: m.content }) as ChatCompletionMessageParam),
    { role: "user", content: userContent },
  ];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    logJson(`model=${args.llm.model} completions iteration=${iteration + 1} messages=${messages.length}`, messages);

    const stream = await getOpenAiClient().chat.completions.create({
      model: args.llm.model,
      messages,
      tools: toolDefinitionsForMode(mode),
      max_tokens: mode === "fundamental" ? 1_000 : 1_600,
      stream: true,
      stream_options: { include_usage: true },
    });

    let text = "";
    const pending: { id: string; name: string; args: string }[] = [];

    for await (const chunk of stream) {
      if (chunk.usage) {
        args.usage.inputTokens += chunk.usage.prompt_tokens ?? 0;
        args.usage.outputTokens += chunk.usage.completion_tokens ?? 0;
      }
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        text += delta.content;
        onText(delta.content);
        yield { type: "text", delta: delta.content };
      }

      for (const call of delta.tool_calls ?? []) {
        const slot = (pending[call.index] ??= { id: "", name: "", args: "" });
        if (call.id) slot.id = call.id;
        if (call.function?.name) slot.name += call.function.name;
        if (call.function?.arguments) slot.args += call.function.arguments;
      }
    }

    const calls = pending.filter((call) => call.name);
    if (calls.length === 0) return;

    messages.push({
      role: "assistant",
      content: text || null,
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.args || "{}" },
      })),
    });

    for (const call of calls) {
      const executed = await runLocalTool(call.id, call.name, call.args, ctx);
      for (const event of executed.events) yield event;
      toolTrace.push(executed.trace);
      messages.push({ role: "tool", tool_call_id: call.id, content: executed.content });
    }
  }
}

interface LocalToolRun {
  events: AgentEvent[];
  content: string;
  trace: NonNullable<ChatMessage["toolTrace"]>[number];
}

async function runLocalTool(id: string, name: string, rawArgs: string, ctx: RunContext): Promise<LocalToolRun> {
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  } catch {
    const summary = "参数解析失败";
    return {
      events: [
        { type: "tool_start", id, name, args: rawArgs },
        { type: "tool_end", id, name, ok: false, summary, durationMs: 0 },
      ],
      content: `工具参数不是合法 JSON：${rawArgs.slice(0, 200)}`,
      trace: { name, summary, ok: false, args: rawArgs, durationMs: 0 },
    };
  }

  const events: AgentEvent[] = [{ type: "tool_start", id, name, args }];
  const started = Date.now();
  try {
    const result = await executeTool(name, args, ctx);
    const durationMs = Date.now() - started;
    const ok = result.ok !== false;
    events.push(...(result.events ?? []));
    events.push({ type: "tool_end", id, name, ok, summary: result.summary, durationMs });
    return {
      events,
      content: result.content,
      trace: { name, summary: result.summary, ok, args, durationMs },
    };
  } catch (error) {
    const durationMs = Date.now() - started;
    const detail = (error as Error).message || "工具执行失败";
    events.push({ type: "tool_end", id, name, ok: false, summary: detail, durationMs });
    return {
      events,
      content: `工具执行失败：${detail}`,
      trace: { name, summary: detail, ok: false, args, durationMs },
    };
  }
}

function webSearchArgs(item: ResponseFunctionWebSearch): Record<string, unknown> {
  const action = item.action;
  if (action.type === "search") {
    return {
      queries: action.queries ?? (action.query ? [action.query] : []),
      sources: action.sources?.map((source) => source.url) ?? [],
    };
  }
  if (action.type === "open_page") return { url: action.url };
  return { url: action.url, pattern: action.pattern };
}

function summarizeWebSearch(item: ResponseFunctionWebSearch): { summary: string; args: unknown; ok: boolean } {
  const ok = item.status !== "failed";
  const args = webSearchArgs(item);
  const action = item.action;
  if (action.type === "search") {
    const query = action.queries?.join("；") || action.query || "";
    const n = action.sources?.length ?? 0;
    return {
      summary: query ? `搜索「${query}」${n ? ` · ${n} 个来源` : ""}` : "联网搜索完成",
      args,
      ok,
    };
  }
  if (action.type === "open_page") {
    return { summary: action.url ? `打开 ${action.url}` : "打开网页", args, ok };
  }
  return { summary: `页内查找「${action.pattern}」`, args, ok };
}

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const record = error as { message?: string; status?: number; error?: { message?: string } };
    return `${record.status ?? ""} ${record.message ?? ""} ${record.error?.message ?? ""}`;
  }
  return String(error);
}

function isResponsesUnsupported(error: unknown): boolean {
  const text = errorText(error).toLowerCase();
  return (
    text.includes("404") ||
    text.includes("/responses") ||
    text.includes("not found") ||
    text.includes("unknown url") ||
    text.includes("no such endpoint")
  );
}

function isWebSearchUnsupported(error: unknown): boolean {
  const text = errorText(error).toLowerCase();
  return text.includes("web_search") || text.includes("hosted tool") || text.includes("unknown tool");
}

/** 告诉模型「用户此刻在看什么」：标的、周期、数据范围、以及图上已有的标注。 */
async function buildSituationPrompt(ctx: RunContext, viewport?: { startTime: number; endTime: number }): Promise<string> {
  const klines = await ctx.klines();
  const lines: string[] = [];
  const info = await getInstrument(ctx.symbol);

  lines.push(`# 当前画布状态`);
  lines.push(
    `标的：${ctx.symbol}${info?.name ? `（${info.name}）` : ""}，周期：${PERIOD_LABELS[ctx.period] ?? ctx.period}，复权：${ctx.adjust}。`,
  );

  if (klines.length > 0) {
    lines.push(
      `本地已有 ${klines.length} 根 K 线，覆盖 ${formatBarTime(klines[0].timestamp, ctx.period)} 至 ` +
        `${formatBarTime(klines[klines.length - 1].timestamp, ctx.period)}。所有日期参数都必须落在这个范围内。`,
    );
  } else {
    lines.push("本地暂无该标的的 K 线数据。");
  }

  if (viewport) {
    lines.push(`用户当前视野：${formatBarTime(viewport.startTime, ctx.period)} ~ ${formatBarTime(viewport.endTime, ctx.period)}。`);
  }

  const { groups, annotations } = listAnnotations(ctx.symbol, ctx.period);
  if (annotations.length === 0) {
    lines.push("图上目前没有任何标注。");
  } else {
    lines.push(`图上已有 ${annotations.length} 条标注，分属 ${groups.length} 组：`);
    for (const group of groups) {
      const items = annotations.filter((a) => a.groupId === group.groupId);
      lines.push(`- 分组「${group.title}」(${group.groupId})：`);
      for (const a of items) {
        const desc =
          a.kind === "event"
            ? `${a.code} @ ${formatBarTime(a.timestamp, ctx.period)} 价 ${a.price}`
            : a.kind === "zone"
              ? `区间「${a.label}」${formatBarTime(a.startTime, ctx.period)}~${formatBarTime(a.endTime, ctx.period)} ${a.low}~${a.high}`
              : a.kind === "level"
                ? `水平线「${a.label}」@ ${a.price}`
                : `趋势线「${a.label}」`;
        lines.push(`  - ${a.id}（${a.source === "user" ? "用户手绘" : "你画的"}）：${desc}`);
      }
    }
    lines.push("需要修改时请用上面的 id 调用 update_annotation，不要整组重画。");
  }

  return lines.join("\n");
}

/** 用户框选区间或点选单根 K 线时，把这段数据的详细摘要注入本轮提问。 */
async function buildContextNote(ctx: RunContext, context: ChatRequest["context"]): Promise<string | null> {
  if (!context) return null;
  const klines = await ctx.klines();
  if (klines.length === 0) return null;

  const body =
    context.kind === "range"
      ? summarizeSelectedRange(klines, ctx.period, context.startTime, context.endTime, context.priceLow, context.priceHigh)
      : summarizeSelectedBar(klines, ctx.period, context.timestamp);

  return `[用户在图上做了选择，以下是这部分的数据明细，请围绕它作答]\n${body}`;
}
