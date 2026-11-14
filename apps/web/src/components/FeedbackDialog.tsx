import { useState } from "react";
import { MessageSquareHeart, Star, X } from "lucide-react";
import * as api from "@/lib/api.js";
import { useI18n } from "@/i18n.js";

export function FeedbackDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  if (!open) return null;

  const submit = async () => {
    if (!rating) {
      setMessage(t("feedback.ratingRequired"));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await api.submitFeedback(rating, comment);
      setDone(true);
      setMessage(t("feedback.thanks", { n: result.credits }));
      window.dispatchEvent(new Event("credits:changed"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("feedback.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mobile-modal-backdrop fixed inset-0 z-[70] flex items-center justify-center bg-ink/35 px-4 backdrop-blur-[3px]" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="feedback-title" className="feedback-card hand-card w-full max-w-[420px] p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="feedback-icon"><MessageSquareHeart size={21} /></div>
          <button type="button" className="hand-icon" aria-label={t("action.close")} onClick={onClose} disabled={busy}><X size={16} /></button>
        </div>
        <div className="hand-eyebrow mt-3">FIRST ANALYSIS · FEEDBACK</div>
        <h2 id="feedback-title" className="mt-1 text-[22px] font-semibold">{done ? t("feedback.doneTitle") : t("feedback.title")}</h2>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">
          {done ? message : t("feedback.body")}
        </p>

        {!done && (
          <>
            <div className="feedback-stars" role="group" aria-label={t("feedback.rating")}>
              {[1, 2, 3, 4, 5].map((score) => (
                <button
                  key={score}
                  type="button"
                  className={rating >= score ? "feedback-star is-active" : "feedback-star"}
                  aria-label={t("feedback.star", { n: score })}
                  aria-pressed={rating === score}
                  onClick={() => setRating(score)}
                ><Star size={28} fill={rating >= score ? "currentColor" : "none"} /></button>
              ))}
            </div>
            <label className="feedback-label mt-4 block">
              {t("feedback.comment")}
              <textarea
                className="hand-input mt-1.5 min-h-[82px] w-full resize-none px-2.5 py-2 text-[13px]"
                maxLength={2000}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder={t("feedback.placeholder")}
              />
            </label>
            <p className="mt-2 text-[10px] text-accent">{t("feedback.reward")}</p>
            {message && <p className="mt-2 rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-2 text-[11px] text-warn">{message}</p>}
            <div className="mt-4 flex items-center gap-2">
              <button type="button" className="hand-link px-2 text-xs text-ink-faint" onClick={onClose} disabled={busy}>{t("feedback.skip")}</button>
              <button type="button" className="hand-btn hand-btn-primary ml-auto px-3 py-2 text-xs" onClick={() => void submit()} disabled={busy}>
                {busy ? t("action.loading") : t("feedback.submit")}
              </button>
            </div>
          </>
        )}
        {done && (
          <button type="button" className="hand-btn hand-btn-primary mt-5 w-full px-3 py-2.5 text-sm" onClick={onClose}>
            {t("feedback.close")}
          </button>
        )}
      </section>
    </div>
  );
}
