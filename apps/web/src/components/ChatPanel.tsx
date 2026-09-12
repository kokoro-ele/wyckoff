import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  MessageSquarePlus,
  Send,
  Sparkles,
  X,
  BookOpen,
  KeyRound,
} from "lucide-react";
import type { AgentEvent, ChatContext } from "@wyckoff/shared";
import { streamChat } from "@/lib/api.js";
import { cn, formatDate, formatDuration, formatPrice } from "@/lib/utils.js";
import { useWorkbench, type ChatEntry, type ToolTraceItem } from "@/store.js";
import { MarkdownContent } from "./MarkdownContent.js";

const AUTO_PROMPT =
  "请对当前视野内的走势做完整的 Wyckoff 结构分析：识别交易区间与阶段（A–E），标注关键事件（如 PS/SC/AR/ST/Spring 或 PSY/BC/UT/UTAD），画出支撑阻力与关键趋势线，并给出操作含义。";

const TOOL_LABELS: Record<string, string> = {
  web_search: "联网搜索",
  get_features: "结构特征",
  get_klines: "K 线明细",
  draw_annotations: "绘制标注",
  clear_annotations: "清除标注",
  update_annotation: "更新标注",
  focus_range: "聚焦区间",
  get_instrument_info: "标的信息",
};

export function ChatPanel() {
  const messages = useWorkbench((s) => s.messages);
  const llmReady = useWorkbench((s) => s.llmReady);
  const pendingContext = useWorkbench((s) => s.pendingContext);
  const setPendingContext = useWorkbench((s) => s.setPendingContext);
  const resetSession = useWorkbench((s) => s.resetSession);
  const setSettingsOpen = useWorkbench((s) => s.setSettingsOpen);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || sending) return;
    const state = useWorkbench.getState();
    if (!state.llmReady) {
      state.setSettingsOpen(true);
      state.notify("请先在连接设置中配置 API Key。", "error");
      return;
    }

    const context = state.pendingContext ?? undefined;
    state.setPendingContext(null);
    setInput("");
    setSending(true);

    const userMsg: ChatEntry = {
      id: `u_${Date.now()}`,
      role: "user",
      content,
      context,
      createdAt: Date.now(),
    };
    const assistantMsg: ChatEntry = {
      id: `a_${Date.now()}`,
      role: "assistant",
      content: "",
      streaming: true,
      liveTrace: [],
      createdAt: Date.now(),
    };
    state.appendMessage(userMsg);
    state.appendMessage(assistantMsg);

    const controller = new AbortController();
    abortRef.current = controller;

    const onEvent = (event: AgentEvent) => {
      const wb = useWorkbench.getState();
      switch (event.type) {
        case "text":
          wb.updateLastAssistant((entry) => ({
            ...entry,
            content: entry.content + event.delta,
          }));
          break;
        case "tool_start":
          wb.updateLastAssistant((entry) => ({
            ...entry,
            liveTrace: [
              ...(entry.liveTrace ?? []),
              { id: event.id, name: event.name, summary: "执行中…", ok: true, running: true, args: event.args },
            ],
          }));
          break;
        case "tool_end":
          wb.updateLastAssistant((entry) => ({
            ...entry,
            liveTrace: (entry.liveTrace ?? []).map((t: ToolTraceItem) =>
              t.id === event.id
                ? { ...t, summary: event.summary, ok: event.ok, running: false, durationMs: event.durationMs }
                : t,
            ),
          }));
          break;
        case "annotations":
          wb.applyAnnotationBatch(event.groupId, event.title, event.annotations);
          break;
        case "annotations_cleared":
          // Agent 侧已改库，前端直接重拉，避免再打一遍删除接口。
          void wb.loadAnnotations();
          break;
        case "focus_range":
          wb.requestFocus(event.startTime, event.endTime);
          break;
        case "done":
          wb.updateLastAssistant((entry) => ({
            ...entry,
            id: event.messageId || entry.id,
            streaming: false,
            toolTrace: (entry.liveTrace ?? [])
              .filter((t) => !t.running)
              .map((t) => ({
                name: t.name,
                summary: t.summary,
                ok: t.ok,
                args: t.args,
                durationMs: t.durationMs,
              })),
          }));
          break;
        case "error":
          wb.updateLastAssistant((entry) => ({
            ...entry,
            streaming: false,
            content: entry.content || event.message,
          }));
          wb.notify(event.message, "error");
          break;
      }
    };

    try {
      await streamChat(
        {
          sessionId: state.sessionId,
          symbol: state.symbol,
          period: state.period,
          adjust: state.adjust,
          message: content,
          context,
          viewport: state.viewport ?? undefined,
        },
        onEvent,
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const message = err instanceof Error ? err.message : "对话失败";
      useWorkbench.getState().updateLastAssistant((entry) => ({
        ...entry,
        streaming: false,
        content: entry.content || message,
      }));
      useWorkbench.getState().notify(message, "error");
    } finally {
      setSending(false);
      abortRef.current = null;
      useWorkbench.getState().updateLastAssistant((entry) => ({ ...entry, streaming: false }));
    }
  };

  return (
    <aside className="glass-panel side-panel flex h-full w-[346px] shrink-0 flex-col overflow-hidden rounded-[20px]">
      <div className="panel-header flex items-center justify-between border-b border-line-soft px-3.5 py-3">
        <div>
          <div className="eyebrow">STRUCTURE INTELLIGENCE</div>
          <div className="mt-0.5 text-[14px] font-semibold tracking-wide text-ink">Wyckoff Agent</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-faint">
            <span className={cn("h-1.5 w-1.5 rounded-full", llmReady ? "bg-down shadow-[0_0_8px_rgba(45,212,168,.8)]" : "bg-warn")} />
            {llmReady ? "模型在线" : "未配置 API Key"}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="API Key 与模型设置"
            aria-label="API Key 与模型设置"
            className="rounded-lg p-1.5 text-ink-faint hover:bg-panel-2 hover:text-ink"
            onClick={() => setSettingsOpen(true)}
          >
            <KeyRound size={14} />
          </button>
          <button
            type="button"
            title="自动读图分析"
            disabled={sending || !llmReady}
            className="glass-btn-primary inline-flex items-center gap-1 rounded-[10px] px-2.5 py-1.5 text-[11px] disabled:opacity-40"
            onClick={() => void send(AUTO_PROMPT)}
          >
            <Sparkles size={12} />
            自动分析
          </button>
          <button
            type="button"
            title="Wyckoff 方法说明"
            className="rounded-lg p-1.5 text-ink-faint hover:bg-panel-2 hover:text-ink"
            onClick={() => window.open("/wyckoff.html", "_blank", "noopener")}
          >
            <BookOpen size={14} />
          </button>
          <button
            type="button"
            title="新会话"
            className="rounded-lg p-1.5 text-ink-faint hover:bg-panel-2 hover:text-ink"
            onClick={resetSession}
          >
            <MessageSquarePlus size={14} />
          </button>
        </div>
      </div>

      <div ref={listRef} className="chat-stream flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <EmptyState llmReady={llmReady} onAnalyze={() => void send(AUTO_PROMPT)} onSettings={() => setSettingsOpen(true)} />
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
      </div>

      <div className="composer-shell border-t border-line-soft p-3">
        {pendingContext && (
          <ContextCapsule context={pendingContext} onClear={() => setPendingContext(null)} />
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            disabled={sending || !llmReady}
            placeholder={
              pendingContext
                ? "针对选中内容提问…"
                : "询问走势含义，或点「自动分析」"
            }
            className="glass-input min-h-[52px] flex-1 resize-none px-2.5 py-2 text-sm text-ink placeholder:text-ink-faint disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={sending || !input.trim() || !llmReady}
            className="glass-btn-primary inline-flex h-[52px] w-10 items-center justify-center rounded-[10px] disabled:opacity-40"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </form>
      </div>
    </aside>
  );
}

function EmptyState({ llmReady, onAnalyze, onSettings }: { llmReady: boolean; onAnalyze: () => void; onSettings: () => void }) {
  return (
    <div className="rounded-[14px] border border-dashed border-line px-3 py-7 text-center">
      <p className="text-sm text-ink-dim">让 Agent 读图并标注 Wyckoff 结构</p>
      <p className="mt-1 text-[11px] text-ink-faint">
        也可在图上单击 K 线或框选区间，再针对选中内容提问
      </p>
      {llmReady ? (
        <button
          type="button"
          onClick={onAnalyze}
          className="glass-btn-primary mt-3 inline-flex items-center gap-1 rounded-[10px] px-3 py-1.5 text-xs"
        >
          <Sparkles size={12} />
          一键自动分析
        </button>
      ) : (
        <button type="button" onClick={onSettings} className="glass-chip mt-3 rounded-[9px] px-3 py-1.5 text-[11px] text-warn">配置 API Key 后开始</button>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatEntry }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
      {message.context && <ContextTag context={message.context} />}
      <div
        className={cn(
          "message-bubble max-w-[95%] rounded-[15px] px-3 py-2 text-[13px] leading-relaxed",
          isUser
            ? "whitespace-pre-wrap bg-accent-soft text-ink border border-accent/25"
            : "bg-panel-2 text-ink border border-line-soft",
          message.streaming && "streaming-caret",
        )}
      >
        {isUser ? (
          message.content || "…"
        ) : (
          <MarkdownContent source={message.content} streaming={message.streaming} />
        )}
      </div>
      {(message.liveTrace?.length || message.toolTrace?.length) ? (
        <div className="w-full space-y-1 px-1">
          {(message.liveTrace ?? message.toolTrace?.map((t, i) => ({ ...t, id: String(i), running: false })) ?? []).map(
            (t) => (
              <div
                key={t.id}
                className={cn(
                  "rounded-[10px] border border-line-soft bg-black/20 px-2 py-1.5 text-[11px]",
                  t.ok === false ? "text-up" : "text-ink-dim",
                )}
              >
                <div className="flex items-start gap-1.5">
                  {t.running ? (
                    <Loader2 size={11} className="mt-0.5 shrink-0 animate-spin text-accent" />
                  ) : (
                    <span className="mt-0.5 shrink-0 font-mono text-[10px] text-ink-faint">
                      {TOOL_LABELS[t.name] ?? t.name}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">{t.summary}</span>
                  {t.durationMs !== undefined && !t.running && (
                    <span className="shrink-0 font-mono text-[10px] text-ink-faint">{formatDuration(t.durationMs)}</span>
                  )}
                </div>
                {t.args !== undefined && t.args !== null && (
                  <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-[6px] bg-black/30 px-1.5 py-1 font-mono text-[10px] leading-relaxed text-ink-faint">
                    {formatToolArgs(t.args)}
                  </pre>
                )}
              </div>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

function ContextCapsule({ context, onClear }: { context: ChatContext; onClear: () => void }) {
  return (
    <div className="mb-2 flex items-center gap-2 rounded-[10px] border border-accent/35 bg-accent-soft px-2.5 py-1.5 text-[11px] text-ink">
      <span className="min-w-0 flex-1 truncate">{describeContext(context)}</span>
      <button type="button" className="text-ink-faint hover:text-ink" onClick={onClear}>
        <X size={12} />
      </button>
    </div>
  );
}

function ContextTag({ context }: { context: ChatContext }) {
  return (
    <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-faint">
      {describeContext(context)}
    </span>
  );
}

function describeContext(context: ChatContext): string {
  if (context.kind === "bar") {
    return `选中 K 线 · ${formatDate(context.timestamp)}`;
  }
  const price =
    context.priceLow !== undefined && context.priceHigh !== undefined
      ? ` · ${formatPrice(context.priceLow)}–${formatPrice(context.priceHigh)}`
      : "";
  return `选中区间 · ${formatDate(context.startTime)} → ${formatDate(context.endTime)}${price}`;
}

function formatToolArgs(args: unknown): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}
