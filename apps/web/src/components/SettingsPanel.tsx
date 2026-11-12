import { useEffect, useState } from "react";
import { KeyRound, LockKeyhole, ShieldCheck, X } from "lucide-react";
import * as api from "@/lib/api.js";
import { useAuth } from "@/auth/AuthProvider.js";
import { useWorkbench } from "@/store.js";
import { ThemeSelector } from "../theme.js";
import { useI18n } from "../i18n.js";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { t, lang, setLang } = useI18n();
  const { isVerified, openAuth } = useAuth();
  const refreshRuntimeStatus = useWorkbench((s) => s.refreshRuntimeStatus);
  const notify = useWorkbench((s) => s.notify);
  const [settings, setSettings] = useState<api.LlmSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("gpt-4o");
  const [apiKey, setApiKey] = useState("");
  const [mode, setMode] = useState<"operator" | "custom">("operator");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    if (!isVerified) return;
    setLoading(true);
    setError("");
    try {
      const value = await api.fetchLlmSettings();
      setSettings(value);
      setBaseUrl(value.baseUrl);
      setModel(value.model);
      setMode(value.mode);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.llm.error"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isVerified) void load();
    // load is intentionally tied to auth identity only
  }, [isVerified]);

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const value = await api.saveLlmSettings({
        mode,
        apiKey: apiKey.trim() || undefined,
        baseUrl,
        model,
      });
      setSettings(value);
      setApiKey("");
      setMode(value.mode);
      await refreshRuntimeStatus(true);
      notify(t("settings.llm.saved"), "info");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.llm.error"));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError("");
    try {
      const value = await api.clearLlmSettings();
      setSettings(value);
      setApiKey("");
      setBaseUrl(value.baseUrl);
      setModel(value.model);
      setMode(value.mode);
      await refreshRuntimeStatus(true);
      notify(t("settings.llm.cleared"), "info");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.llm.error"));
    } finally {
      setBusy(false);
    }
  };

  const sourceLabel = settings
    ? settings.source === "user"
      ? t("settings.llm.source.user")
      : settings.source === "operator"
        ? t("settings.llm.source.operator")
        : t("settings.llm.source.none")
    : "";
  const canSave = !busy && (mode === "operator" || Boolean(settings?.custom) || apiKey.trim().length > 0);

  return (
    <div
      className="mobile-modal-backdrop fixed inset-0 z-50 flex items-start justify-center bg-ink/35 px-4 pt-[10vh] backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="hand-card max-h-[84vh] w-full max-w-[460px] overflow-y-auto p-5"
      >
        <div className="flex items-center justify-between">
          <h2 id="settings-title" className="text-[22px] font-semibold">{t("settings.title")}</h2>
          <button type="button" aria-label={t("action.close")} className="hand-icon" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        <div className="mt-5 space-y-3">
          <div className="hand-row flex items-center justify-between gap-3">
            <span className="text-sm">{t("settings.language")}</span>
            <div className="flex gap-1">
              <button type="button" className={`hand-chip ${lang === "zh" ? "hand-chip-active" : ""}`} onClick={() => setLang("zh")}>
                {t("settings.zh")}
              </button>
              <button type="button" className={`hand-chip ${lang === "en" ? "hand-chip-active" : ""}`} onClick={() => setLang("en")}>
                {t("settings.en")}
              </button>
            </div>
          </div>
          <div className="hand-row flex items-center justify-between gap-3">
            <span className="text-sm">{t("settings.theme")}</span>
            <ThemeSelector />
          </div>
        </div>

        <div className="mt-5 border-t border-dashed border-line-soft pt-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <KeyRound size={14} className="text-accent" />
              <h3 className="text-sm font-semibold">{t("settings.llm.title")}</h3>
            </div>
            {settings && <span className="hand-chip hand-chip-active text-[10px]">{sourceLabel}</span>}
          </div>

          {!isVerified ? (
            <div className="mt-3 rounded-lg border border-dashed border-line p-3 text-[11px] text-ink-dim">
              <p>{t("settings.llm.login")}</p>
              <button type="button" className="hand-btn hand-btn-primary mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs" onClick={openAuth}>
                <LockKeyhole size={13} />
                {t("auth.loginToAnalyze")}
              </button>
            </div>
          ) : loading && !settings ? (
            <p className="mt-3 text-[11px] text-ink-faint">{t("action.loading")}</p>
          ) : (
            <>
              <div className="mt-3">
                <div className="text-[10px] text-ink-faint">{t("settings.llm.mode")}</div>
                <div className="mt-1 flex gap-1">
                  <button type="button" className={`hand-chip ${mode === "operator" ? "hand-chip-active" : ""}`} onClick={() => setMode("operator")}>
                    {t("settings.llm.mode.operator")}
                  </button>
                  <button type="button" className={`hand-chip ${mode === "custom" ? "hand-chip-active" : ""}`} onClick={() => setMode("custom")}>
                    {t("settings.llm.mode.custom")}
                  </button>
                </div>
              </div>

              {mode === "operator" ? (
                <p className="mt-2 text-[10px] leading-relaxed text-ink-faint">
                  {settings?.operatorConfigured ? t("settings.llm.operatorCredit") : t("settings.llm.operatorUnavailable")}
                </p>
              ) : (
                <>
                  <p className="mt-2 text-[10px] leading-relaxed text-ink-faint">{t("settings.llm.customCredit")}</p>
                  <div className="mt-3 space-y-2.5">
                    <label className="hand-label">
                      {t("settings.llm.baseUrl")}
                      <input
                        className="hand-input font-mono text-[11px]"
                        value={baseUrl}
                        onChange={(event) => setBaseUrl(event.target.value)}
                        placeholder="https://api.deepseek.com"
                        spellCheck={false}
                      />
                    </label>
                    <label className="hand-label">
                      {t("settings.llm.model")}
                      <input
                        className="hand-input font-mono text-[11px]"
                        value={model}
                        onChange={(event) => setModel(event.target.value)}
                        placeholder="deepseek-flash"
                        spellCheck={false}
                      />
                    </label>
                    <label className="hand-label">
                      {t("settings.llm.apiKey")}
                      <input
                        className="hand-input font-mono text-[11px]"
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder={settings?.custom ? t("settings.llm.keyConfigured") : t("settings.llm.keyPlaceholder")}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                  </div>
                </>
              )}
              {error && <p className="mt-2 rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-2 text-[11px] text-warn">{error}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="hand-btn hand-btn-primary px-3 py-1.5 text-xs" disabled={!canSave} onClick={() => void save()}>
                  {busy ? t("settings.llm.saving") : t("settings.llm.save")}
                </button>
                {settings?.custom && (
                  <button type="button" className="hand-btn px-3 py-1.5 text-xs" disabled={busy} onClick={() => void clear()}>
                    {t("settings.llm.clear")}
                  </button>
                )}
              </div>
              {mode === "custom" && (
                <p className="mt-3 flex items-start gap-1.5 text-[9px] leading-relaxed text-ink-faint">
                  <ShieldCheck size={12} className="mt-0.5 shrink-0 text-down" />
                  <span>{t("settings.llm.security")}</span>
                </p>
              )}
            </>
          )}
        </div>

        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 border-t border-dashed border-line-soft pt-3 text-[10px] text-ink-faint">
          <a href="/privacy" className="hover:text-accent">{t("legal.privacy")}</a>
          <a href="/terms" className="hover:text-accent">{t("legal.terms")}</a>
          <a href="/refund" className="hover:text-accent">{t("legal.refund")}</a>
          <a href="/contact" className="hover:text-accent">{t("legal.contact")}</a>
        </div>
      </section>
    </div>
  );
}
