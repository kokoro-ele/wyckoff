import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Loader2,
  LockKeyhole,
  MessageSquarePlus,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import type { AgentEvent, ChatContext } from "@wyckoff/shared";
import { ApiError, streamChat } from "@/lib/api.js";
import { cn, formatDate, formatDuration, formatPrice } from "@/lib/utils.js";
import { useWorkbench, type ChatEntry, type ToolTraceItem } from "@/store.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { ResearchPanel } from "./ResearchPanel.js";
import { useAuth } from "@/auth/AuthProvider.js";
import { useI18n } from "@/i18n.js";

const THINKING_KEYS = [
  "chat.thinking.agent.1",
  "chat.thinking.agent.2",
  "chat.thinking.agent.3",
  "chat.thinking.agent.4",
];

const SHOW_TRACE = import.meta.env.DEV || import.meta.env.VITE_SHOW_AGENT_TRACE === "1";

export function ChatPanel() {
  const { t, lang } = useI18n();
  const { isVerified, requireAuth, openAuth } = useAuth();
  const symbol = useWorkbench((s) => s.symbol);
  const period = useWorkbench((s) => s.period);
  const adjust = useWorkbench((s) => s.adjust);
  const messages = useWorkbench((s) => s.messages);
  const llmReady = useWorkbench((s) => s.llmReady);
  const resetSession = useWorkbench((s) => s.resetSession);
  const pendingContext = useWorkbench((s) => s.pendingContext);
  const setPendingContext = useWorkbench((s) => s.setPendingContext);
  const [dockTab, setDockTab] = useState<"research" | "agent">(() =>
    new URLSearchParams(window.location.search).get("tab") === "agent" ? "agent" : "research",
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [thinkingIndex, setThinkingIndex] = useState(0);
  const sendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(
    () => messages.filter((message) => (message.mode ?? "agent") === "agent"),
    [messages],
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (dockTab !== "agent") return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [visible, sending, dockTab]);

  useEffect(() => {
    if (!sending) return;
    setThinkingIndex(0);
    const timer = window.setInterval(() => setThinkingIndex((index) => (index + 1) % 4), 1800);
    return () => window.clearInterval(timer);
  }, [sending]);

  const execute = async (text: string) => {
    const content = text.trim();
    if (!content || sendingRef.current) return;
    const state = useWorkbench.getState();
    if (!state.llmReady) {
      state.notify(t("error.SERVICE_UNAVAILABLE"), "error");
      return;
    }

    const context = state.pendingContext ?? undefined;
    state.setPendingContext(null);
    setInput("");
    sendingRef.current = true;
    setSending(true);

    const userMsg: ChatEntry = {
      id: `u_${Date.now()}`,
      role: "user",
      content,
      mode: "agent",
      context,
      createdAt: Date.now(),
    };
    const assistantMsg: ChatEntry = {
      id: `a_${Date.now()}`,
      role: "assistant",
      content: "",
      mode: "agent",
      streaming: true,
      liveTrace: [],
      createdAt: Date.now(),
    };
    state.appendMessage(userMsg);
    state.appendMessage(assistantMsg);

    const controller = new AbortController();
    abortRef.current = controller;

    const current = () => {
      const wb = useWorkbench.getState();
      return !controller.signal.aborted && wb.chartRevision === state.chartRevision && wb.sessionId === state.sessionId;
    };
    let abortedByContext = false;
    const unsubscribe = useWorkbench.subscribe(() => {
      if (!current()) {
        abortedByContext = true;
        controller.abort();
        sendingRef.current = false;
        setSending(false);
      }
    });

    const updateAssistant = (updater: (entry: ChatEntry) => ChatEntry) => {
      useWorkbench.getState().updateLastAssistant(updater);
    };

    const onEvent = (event: AgentEvent) => {
      if (!current()) return;
      const wb = useWorkbench.getState();
      switch (event.type) {
        case "text":
          updateAssistant((entry) => ({ ...entry, content: entry.content + event.delta }));
          break;
        case "tool_start":
          updateAssistant((entry) => ({
            ...entry,
            liveTrace: [
              ...(entry.liveTrace ?? []),
              { id: event.id, name: event.name, summary: "…", ok: true, running: true, args: event.args },
            ],
          }));
          break;
        case "tool_end":
          updateAssistant((entry) => ({
            ...entry,
            liveTrace: (entry.liveTrace ?? []).map((trace: ToolTraceItem) =>
              trace.id === event.id
                ? { ...trace, summary: event.summary, ok: event.ok, running: false, durationMs: event.durationMs }
                : trace,
            ),
          }));
          break;
        case "annotations":
          wb.applyAnnotationBatch(event.groupId, event.title, event.annotations);
          break;
        case "annotations_cleared":
          void wb.loadAnnotations();
          break;
        case "focus_range":
          wb.requestFocus(event.startTime, event.endTime);
          break;
        case "done":
          updateAssistant((entry) => ({
            ...entry,
            id: event.messageId || entry.id,
            streaming: false,
            toolTrace: (entry.liveTrace ?? [])
              .filter((trace) => !trace.running)
              .map((trace) => ({
                name: trace.name,
                summary: trace.summary,
                ok: trace.ok,
                args: trace.args,
                durationMs: trace.durationMs,
              })),
          }));
          break;
        case "error":
          updateAssistant((entry) => ({
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
          mode: "agent",
          language: lang,
          showTrace: SHOW_TRACE,
          context,
          viewport: state.viewport ?? undefined,
        },
        onEvent,
        controller.signal,
      );
    } catch (error) {
      if ((error as Error).name === "AbortError" || !current()) return;
      const code = error instanceof ApiError ? error.code : "CHAT_FAILED";
      const message =
        code === "QUOTA_EXCEEDED"
          ? t("chat.quota")
          : error instanceof Error
            ? error.message
            : t("chat.error");
      if (code === "QUOTA_EXCEEDED") window.dispatchEvent(new Event("credits:exhausted"));
      if (code === "UNAUTHORIZED" || code === "EMAIL_UNVERIFIED") openAuth();
      updateAssistant((entry) => ({
        ...entry,
        streaming: false,
        content: entry.content || message,
      }));
      useWorkbench.getState().notify(message, "error");
    } finally {
      window.dispatchEvent(new Event("credits:changed"));
      unsubscribe();
      if (abortRef.current === controller) {
        sendingRef.current = false;
        setSending(false);
        abortRef.current = null;
      }
      if (!abortedByContext && current()) {
        updateAssistant((entry) => ({ ...entry, streaming: false }));
      }
    }
  };

  const send = (text: string) => {
    if (!text.trim() || sendingRef.current) return;
    if (!isVerified) {
      requireAuth(() => void execute(text));
      return;
    }
    void execute(text);
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    sendingRef.current = false;
    setSending(false);
    useWorkbench.getState().updateLastAssistant((entry) => ({
      ...entry,
      streaming: false,
      liveTrace: entry.liveTrace?.map((trace) =>
        trace.running ? { ...trace, running: false, ok: false, summary: t("chat.stopped") } : trace,
      ),
    }));
    useWorkbench.getState().notify(t("chat.stopped"), "info");
  };

  const analyze = () => {
    setDockTab("agent");
    send(t("chat.autoPrompt.agent"));
  };
  const thinking = t(THINKING_KEYS[thinkingIndex] ?? THINKING_KEYS[0]);
  const agent = dockTab === "agent";

  return (
    <aside className="glass-panel side-panel chat-panel flex h-full w-[346px] shrink-0 flex-col overflow-hidden rounded-[22px]">
      <div className="chat-head panel-header px-3.5 pb-2 pt-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="hand-eyebrow">STRUCTURE INTELLIGENCE</div>
            <div className="mt-0.5 text-[15px] font-semibold tracking-wide">
              {agent ? "Wyckoff Agent" : t("research.title")}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {agent && (
              <>
                <button type="button" title={t("chat.method")} aria-label={t("chat.method")} className="hand-icon" onClick={() => window.open("/wyckoff.html", "_blank", "noopener")}>
                  <BookOpen size={15} />
                </button>
                <button type="button" title={t("chat.newSession")} aria-label={t("chat.newSession")} className="hand-icon" onClick={resetSession}>
                  <MessageSquarePlus size={15} />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="chat-tabs chat-tabs-two mt-3" role="tablist" aria-label="research and agent">
          <button type="button" role="tab" aria-selected={dockTab === "research"} className={cn("chat-tab", dockTab === "research" && "chat-tab-active")} onClick={() => setDockTab("research")}>
            <BookOpen size={14} />
            <span>{t("research.tab")}</span>
          </button>
          <button type="button" role="tab" aria-selected={dockTab === "agent"} className={cn("chat-tab", dockTab === "agent" && "chat-tab-active")} onClick={() => setDockTab("agent")}>
            <Sparkles size={14} />
            <span>{t("research.agentTab")}</span>
          </button>
        </div>
      </div>

      {dockTab === "research" ? (
        <ResearchPanel symbol={symbol} period={period} adjust={adjust} onRequestAnalysis={analyze} />
      ) : (
        <>
          <div ref={listRef} className="chat-stream flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {visible.length === 0 && (
              <TabIntro verified={isVerified} llmReady={llmReady} onLogin={openAuth} onRun={() => void send(t("chat.autoPrompt.agent"))} />
            )}
            {visible.map((message) => (
              <MessageBubble key={message.id} message={message} showTrace={SHOW_TRACE} />
            ))}
            {sending && <ThinkingBubble label={thinking} />}
          </div>

          <div className="chat-composer border-t border-line-soft p-3">
            {pendingContext && <ContextCapsule context={pendingContext} onClear={() => setPendingContext(null)} />}
            <p className="mb-2 text-[10px] text-ink-faint">{t("chat.creditsNote")}</p>
            <form
              className="flex items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void send(input);
              }}
            >
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send(input);
                  }
                }}
                rows={2}
                disabled={sending || !llmReady}
                placeholder={isVerified ? t("chat.placeholder.agent") : t("chat.loginHint")}
                className="hand-input min-h-[56px] flex-1 resize-none px-2.5 py-2 text-sm disabled:opacity-60"
              />
              {sending ? (
                <button type="button" onClick={stop} aria-label={t("chat.stop")} title={t("chat.stop")} className="hand-btn hand-btn-primary h-[56px] w-11 justify-center">
                  <Square size={16} />
                </button>
              ) : (
                <button type="submit" disabled={!input.trim() || !llmReady} className="hand-btn hand-btn-primary h-[56px] w-11 justify-center disabled:opacity-40">
                  <Send size={16} />
                </button>
              )}
            </form>
          </div>
        </>
      )}
    </aside>
  );
}

function TabIntro({
  verified,
  llmReady,
  onLogin,
  onRun,
}: {
  verified: boolean;
  llmReady: boolean;
  onLogin: () => void;
  onRun: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="hand-empty hand-doodle px-4 py-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-line bg-panel-2 text-accent">
        <Sparkles size={22} />
      </div>
      <p className="mt-3 text-[13px] font-semibold">{t("chat.intro.agent")}</p>
      {!verified ? (
        <>
          <p className="mt-1.5 text-[11px] text-ink-dim">{t("chat.loginHint")}</p>
          <button type="button" className="hand-btn hand-btn-primary mt-4 inline-flex items-center gap-1.5 px-3 py-2 text-xs" onClick={onLogin}>
            <LockKeyhole size={13} />
            {t("chat.loginToAnalyze")}
          </button>
        </>
      ) : llmReady ? (
        <button type="button" className="hand-btn hand-btn-primary mt-4 inline-flex items-center gap-1.5 px-3 py-2 text-xs" onClick={onRun}>
          <Sparkles size={13} />
          {t("chat.cta.agent")}
        </button>
      ) : (
        <p className="mt-3 text-[11px] text-warn">{t("error.SERVICE_UNAVAILABLE")}</p>
      )}
    </div>
  );
}

function ThinkingBubble({ label }: { label: string }) {
  return (
    <div className="thinking-bubble" role="status" aria-live="polite">
      <span className="thinking-pencil" aria-hidden="true">✎</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="thinking-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}

function MessageBubble({ message, showTrace }: { message: ChatEntry; showTrace: boolean }) {
  const { t } = useI18n();
  const isUser = message.role === "user";
  const trace = message.liveTrace?.length
    ? message.liveTrace
    : message.toolTrace?.map((entry, index) => ({ ...entry, id: String(index), running: false }));
  return (
    <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
      {message.context && <ContextTag context={message.context} />}
      <div
        className={cn(
          "message-bubble max-w-[95%] rounded-[16px] border px-3 py-2 text-[13px] leading-relaxed",
          isUser ? "border-accent/30 bg-accent-soft text-ink" : "border-line-soft bg-panel-2 text-ink",
          message.streaming && "streaming-caret",
        )}
      >
        {isUser ? message.content || "…" : <MarkdownContent source={message.content} streaming={message.streaming} />}
      </div>
      {showTrace && trace && trace.length > 0 && (
        <div className="w-full space-y-1 px-1">
          <div className="text-[9px] uppercase tracking-[0.18em] text-ink-faint">{t("chat.trace")}</div>
          {trace.map((entry) => (
            <div
              key={entry.id}
              className={cn(
                "rounded-[10px] border border-line-soft bg-black/10 px-2 py-1.5 text-[11px]",
                entry.ok === false ? "text-up" : "text-ink-dim",
              )}
            >
              <div className="flex items-start gap-1.5">
                {entry.running ? (
                  <Loader2 size={11} className="mt-0.5 shrink-0 animate-spin text-accent" />
                ) : (
                  <span className="mt-0.5 shrink-0 font-mono text-[10px] text-ink-faint">
                    {t(`tool.${entry.name}`) === `tool.${entry.name}` ? entry.name : t(`tool.${entry.name}`)}
                  </span>
                )}
                <span className="min-w-0 flex-1">{entry.summary}</span>
                {entry.durationMs !== undefined && !entry.running && (
                  <span className="shrink-0 font-mono text-[10px] text-ink-faint">{formatDuration(entry.durationMs)}</span>
                )}
              </div>
              {entry.args !== undefined && entry.args !== null && (
                <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-[6px] bg-black/20 px-1.5 py-1 font-mono text-[10px] leading-relaxed text-ink-faint">
                  {formatToolArgs(entry.args)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ContextCapsule({ context, onClear }: { context: ChatContext; onClear: () => void }) {
  const { t } = useI18n();
  return (
    <div className="mb-2 flex items-center gap-2 rounded-[12px] border border-accent/35 bg-accent-soft px-2.5 py-1.5 text-[11px]">
      <span className="min-w-0 flex-1 truncate">{describeContext(context, t)}</span>
      <button type="button" aria-label={t("chat.context.clear")} className="text-ink-faint hover:text-ink" onClick={onClear}>
        <X size={12} />
      </button>
    </div>
  );
}

function ContextTag({ context }: { context: ChatContext }) {
  const { t } = useI18n();
  return <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-faint">{describeContext(context, t)}</span>;
}

function describeContext(context: ChatContext, t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (context.kind === "bar") return t("chat.context.bar", { date: formatDate(context.timestamp) });
  const price =
    context.priceLow !== undefined && context.priceHigh !== undefined
      ? ` · ${formatPrice(context.priceLow)}–${formatPrice(context.priceHigh)}`
      : "";
  return t("chat.context.range", {
    from: formatDate(context.startTime),
    to: `${formatDate(context.endTime)}${price}`,
  });
}

function formatToolArgs(args: unknown): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}
