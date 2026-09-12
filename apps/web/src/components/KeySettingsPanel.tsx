import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { RuntimeLlmSettings, UpdateLlmSettingsRequest } from "@wyckoff/shared";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  Server,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { fetchRuntimeSettings, updateLlmSettings } from "@/lib/api.js";
import { cn } from "@/lib/utils.js";
import { useWorkbench } from "@/store.js";

interface KeySettingsPanelProps {
  onClose: () => void;
}

interface SettingsDraft {
  apiKey: string;
  baseUrl: string;
  model: string;
  webSearch: boolean;
}

const EMPTY_DRAFT: SettingsDraft = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o",
  webSearch: true,
};

const INPUT_CLASS =
  "h-10 w-full rounded-[10px] border border-line-soft bg-black/15 px-3 text-[12px] text-ink transition-colors placeholder:text-ink-faint/70 hover:border-line focus:border-accent/45";

export function KeySettingsPanel({ onClose }: KeySettingsPanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const refreshRuntimeStatus = useWorkbench((state) => state.refreshRuntimeStatus);
  const notify = useWorkbench((state) => state.notify);
  const [settings, setSettings] = useState<RuntimeLlmSettings | null>(null);
  const [draft, setDraft] = useState<SettingsDraft>(EMPTY_DRAFT);
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchRuntimeSettings()
      .then((response) => {
        if (cancelled) return;
        setSettings(response.llm);
        setDraft((current) => ({
          ...current,
          baseUrl: response.llm.baseUrl,
          model: response.llm.model,
          webSearch: response.llm.webSearch,
        }));
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(messageOf(cause, "无法读取本地连接设置"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    requestAnimationFrame(() => dialog?.querySelector<HTMLElement>("[data-autofocus]")?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || removing) return;
    setSaving(true);
    setError(null);
    setClearArmed(false);
    const payload: UpdateLlmSettingsRequest = {
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim(),
      webSearch: draft.webSearch,
      ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
    };
    try {
      const response = await updateLlmSettings(payload);
      setSettings(response.llm);
      setDraft((current) => ({ ...current, apiKey: "" }));
      setShowKey(false);
      await refreshRuntimeStatus();
      notify("连接设置已保存并立即生效");
    } catch (cause) {
      setError(messageOf(cause, "保存连接设置失败"));
    } finally {
      setSaving(false);
    }
  };

  const removeLocalKey = async () => {
    if (!clearArmed || settings?.source !== "local" || saving || removing) return;
    setRemoving(true);
    setError(null);
    try {
      const response = await updateLlmSettings({ removeLocalKey: true });
      setSettings(response.llm);
      setDraft((current) => ({
        ...current,
        apiKey: "",
        baseUrl: response.llm.baseUrl,
        model: response.llm.model,
        webSearch: response.llm.webSearch,
      }));
      setClearArmed(false);
      setShowKey(false);
      await refreshRuntimeStatus();
      notify(response.llm.configured ? "已移除页面保存的 Key，当前回退到环境变量" : "已从本机设置中移除 API Key");
    } catch (cause) {
      setError(messageOf(cause, "移除本地 API Key 失败"));
    } finally {
      setRemoving(false);
    }
  };

  const busy = loading || saving || removing;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#02050b]/84 p-3 backdrop-blur-md sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="key-settings-title"
        aria-describedby="key-settings-description"
        className="glass-panel-strong modal-glass grid max-h-[860px] w-full max-w-[980px] overflow-hidden rounded-[24px] animate-rise lg:grid-cols-[320px_minmax(0,1fr)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <aside className="relative overflow-hidden border-b border-line-soft bg-[radial-gradient(circle_at_18%_5%,rgba(87,161,255,.16),transparent_44%)] p-5 lg:border-b-0 lg:border-r lg:p-6">
          <div className="eyebrow">LOCAL CONNECTION VAULT</div>
          <div className="mt-4 grid h-12 w-12 place-items-center rounded-[15px] border border-accent/25 bg-accent-soft text-accent shadow-[0_0_32px_rgba(71,146,238,.12)]">
            <KeyRound size={22} />
          </div>
          <h2 id="key-settings-title" className="mt-4 text-[20px] font-semibold tracking-tight text-ink">
            API Key 连接设置
          </h2>
          <p id="key-settings-description" className="mt-2 text-[11px] leading-relaxed text-ink-dim">
            在本机连接 OpenAI 或兼容模型服务。密钥不会写入源码、Git、浏览器缓存或接口响应。
          </p>

          <ConnectionStatus settings={settings} loading={loading} />

          <div className="mt-5 space-y-3 border-t border-line-soft pt-5 text-[10px] leading-relaxed text-ink-faint">
            <SecurityPoint icon={LockKeyhole} title="只存本机" text="页面保存的 Key 位于 data/runtime-settings.json，目录已被 Git 忽略。" />
            <SecurityPoint icon={ShieldCheck} title="永不回显" text="读取设置时只返回是否已配置，服务端不会返回 Key 或尾号。" />
            <SecurityPoint icon={Server} title="即时生效" text="保存后服务端会重建模型客户端，不需要重启应用。" />
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          <header className="panel-header flex items-center justify-between border-b border-line-soft px-5 py-4">
            <div>
              <div className="text-[13px] font-semibold text-ink">模型连接</div>
              <div className="mt-0.5 font-mono text-[9px] text-ink-faint">OPENAI-COMPATIBLE ENDPOINT</div>
            </div>
            <button
              type="button"
              data-autofocus
              title="关闭连接设置"
              aria-label="关闭连接设置"
              disabled={busy}
              onClick={onClose}
              className="rounded-lg p-2 text-ink-faint transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-40"
            >
              <X size={16} />
            </button>
          </header>

          <form className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6" onSubmit={save}>
            <div className="space-y-5">
              <div>
                <label htmlFor="settings-api-key" className="text-[11px] font-medium text-ink">API Key</label>
                <p className="mb-2 mt-1 text-[9px] leading-relaxed text-ink-faint">
                  {settings?.configured ? "已有 Key 正在生效；留空保存会保留原 Key。" : "填写服务商提供的 Key。保存后输入框会立即清空。"}
                </p>
                <div className="relative">
                  <input
                    id="settings-api-key"
                    type={showKey ? "text" : "password"}
                    autoComplete="new-password"
                    spellCheck={false}
                    value={draft.apiKey}
                    onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
                    placeholder={settings?.configured ? "••••••••  留空以保留当前 Key" : "sk-…"}
                    className={cn(INPUT_CLASS, "pr-11 font-mono")}
                    maxLength={4096}
                  />
                  <button
                    type="button"
                    aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                    title={showKey ? "隐藏 API Key" : "显示 API Key"}
                    onClick={() => setShowKey((current) => !current)}
                    className="absolute inset-y-0 right-1.5 my-auto grid h-8 w-8 place-items-center rounded-md text-ink-faint hover:bg-panel-2 hover:text-ink"
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label htmlFor="settings-base-url" className="text-[11px] font-medium text-ink">Base URL</label>
                  <p className="mb-2 mt-1 text-[9px] text-ink-faint">必须是 HTTP(S) 地址；官方 OpenAI 使用默认值。</p>
                  <input id="settings-base-url" type="url" required value={draft.baseUrl} onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))} className={cn(INPUT_CLASS, "font-mono")} maxLength={512} />
                </div>
                <div>
                  <label htmlFor="settings-model" className="text-[11px] font-medium text-ink">模型</label>
                  <p className="mb-2 mt-1 text-[9px] text-ink-faint">填写网关实际支持的模型 ID。</p>
                  <input id="settings-model" required value={draft.model} onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))} className={cn(INPUT_CLASS, "font-mono")} maxLength={128} />
                </div>
                <label className="flex min-h-[66px] cursor-pointer items-center justify-between gap-3 rounded-[12px] border border-line-soft bg-black/10 px-3.5 py-3 hover:border-line">
                  <span><span className="block text-[11px] font-medium text-ink">联网搜索</span><span className="mt-1 block text-[9px] text-ink-faint">仅影响常规 Agent；匿名回测始终关闭联网。</span></span>
                  <input type="checkbox" checked={draft.webSearch} onChange={(event) => setDraft((current) => ({ ...current, webSearch: event.target.checked }))} className="h-4 w-4 shrink-0 accent-[#73b6ff]" />
                </label>
              </div>

              {error ? <div role="alert" className="rounded-[11px] border border-up/25 bg-up/5 px-3 py-2.5 text-[10px] leading-relaxed text-up">{error}</div> : null}

              <div className="rounded-[13px] border border-line-soft bg-black/10 p-3.5">
                <div className="flex items-start justify-between gap-4">
                  <div><div className="text-[10px] font-medium text-ink">移除页面保存的 Key</div><p className="mt-1 text-[9px] leading-relaxed text-ink-faint">只删除本机设置文件中的 Key；如果 `.env` 仍有 Key，会自动回退使用。</p></div>
                  {clearArmed ? (
                    <div className="flex shrink-0 gap-1.5">
                      <button type="button" disabled={busy} onClick={() => setClearArmed(false)} className="glass-chip rounded-[8px] px-2.5 py-1 text-[10px]">取消</button>
                      <button type="button" disabled={busy} onClick={() => void removeLocalKey()} className="rounded-[8px] border border-up/25 bg-up/8 px-2.5 py-1 text-[10px] text-up disabled:opacity-40">确认移除</button>
                    </div>
                  ) : (
                    <button type="button" disabled={busy || settings?.source !== "local"} onClick={() => setClearArmed(true)} className="inline-flex shrink-0 items-center gap-1.5 rounded-[8px] border border-line-soft px-2.5 py-1.5 text-[10px] text-ink-dim hover:border-up/25 hover:text-up disabled:cursor-not-allowed disabled:opacity-35"><Trash2 size={11} /> 移除</button>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between gap-3 border-t border-line-soft pt-4">
              <p className="max-w-[320px] text-[9px] leading-relaxed text-ink-faint">保存动作不会验证或调用模型，因此不会产生 API 费用。</p>
              <button type="submit" disabled={busy || !draft.baseUrl.trim() || !draft.model.trim()} className="glass-btn-primary inline-flex h-10 min-w-[142px] items-center justify-center gap-2 rounded-[11px] px-4 text-[11px] disabled:cursor-not-allowed disabled:opacity-40">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                {saving ? "安全保存中…" : "保存并立即生效"}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

function ConnectionStatus({ settings, loading }: { settings: RuntimeLlmSettings | null; loading: boolean }) {
  const sourceLabel = settings?.source === "local" ? "本机设置" : settings?.source === "environment" ? "环境变量" : "尚未连接";
  return (
    <div className="mt-5 rounded-[14px] border border-line-soft bg-black/15 p-3.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[9px] font-medium uppercase tracking-[.14em] text-ink-faint">Connection</span>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px]", settings?.configured ? "border-down/25 bg-down/8 text-down" : "border-warn/25 bg-warn/8 text-warn")}>
          <span className={cn("h-1.5 w-1.5 rounded-full", settings?.configured ? "bg-down" : "bg-warn")} />
          {loading ? "读取中" : settings?.configured ? "已连接" : "待配置"}
        </span>
      </div>
      <div className="mt-3 font-mono text-[11px] text-ink">{loading ? "…" : settings?.model || "未选择模型"}</div>
      <div className="mt-1 text-[9px] text-ink-faint">来源 · {sourceLabel}</div>
    </div>
  );
}

function SecurityPoint({ icon: Icon, title, text }: { icon: typeof LockKeyhole; title: string; text: string }) {
  return <div className="flex gap-2.5"><Icon size={13} className="mt-0.5 shrink-0 text-accent/80" /><div><div className="font-medium text-ink-dim">{title}</div><div className="mt-0.5">{text}</div></div></div>;
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
