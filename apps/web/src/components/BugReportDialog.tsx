import { useState } from "react";
import { Bug, Check, LogIn, Send, X } from "lucide-react";
import * as api from "@/lib/api.js";
import { useAuth } from "@/auth/AuthProvider.js";
import { useI18n } from "@/i18n.js";

export function BugReportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { isVerified, openAuth } = useAuth();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  if (!open) return null;

  const submit = async () => {
    if (!title.trim() || !body.trim()) {
      setError(t("bug.required"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.submitBug({ title, body, pageUrl: window.location.href });
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("bug.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mobile-modal-backdrop fixed inset-0 z-[72] flex items-center justify-center bg-ink/35 px-4 backdrop-blur-[3px]" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="bug-title" className="bug-card hand-card w-full max-w-[430px] p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="bug-icon"><Bug size={21} /></div>
          <button type="button" className="hand-icon" aria-label={t("action.close")} onClick={onClose}><X size={16} /></button>
        </div>
        <div className="hand-eyebrow mt-3">BUG REPORT</div>
        <h2 id="bug-title" className="mt-1 text-[22px] font-semibold">{done ? t("bug.doneTitle") : t("bug.title")}</h2>
        {!isVerified ? (
          <div className="mt-3 rounded-lg border border-dashed border-line p-3">
            <p className="text-[11px] leading-relaxed text-ink-dim">{t("bug.loginHint")}</p>
            <button type="button" className="hand-btn hand-btn-primary mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs" onClick={() => openAuth()}>
              <LogIn size={13} />{t("account.login")}
            </button>
          </div>
        ) : done ? (
          <div className="mt-3 rounded-lg border border-down/30 bg-down/10 p-3 text-[12px] leading-relaxed text-down">
            <Check size={15} className="mb-1" />
            <p>{t("bug.doneBody")}</p>
          </div>
        ) : (
          <>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">{t("bug.body")}</p>
            <p className="mt-2 rounded-lg border border-dashed border-accent/30 bg-accent-soft/50 px-2.5 py-2 text-[11px] text-accent">{t("bug.reward")}</p>
            <label className="hand-label mt-3 block">
              {t("bug.subject")}
              <input className="hand-input mt-1 w-full px-2.5 py-2 text-[13px]" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t("bug.subjectPlaceholder")} />
            </label>
            <label className="hand-label mt-3 block">
              {t("bug.details")}
              <textarea className="hand-input mt-1 min-h-[110px] w-full resize-none px-2.5 py-2 text-[13px]" maxLength={4000} value={body} onChange={(event) => setBody(event.target.value)} placeholder={t("bug.detailsPlaceholder")} />
            </label>
            {error && <p className="mt-2 rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-2 text-[11px] text-warn">{error}</p>}
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-[9px] text-ink-faint">{t("bug.pageAttached")}</span>
              <button type="button" className="hand-btn hand-btn-primary inline-flex items-center gap-1.5 px-3 py-2 text-xs" disabled={busy} onClick={() => void submit()}>
                <Send size={12} />{busy ? t("action.loading") : t("bug.submit")}
              </button>
            </div>
          </>
        )}
        {done && <button type="button" className="hand-btn hand-btn-primary mt-4 w-full px-3 py-2 text-sm" onClick={onClose}>{t("action.close")}</button>}
      </section>
    </div>
  );
}
