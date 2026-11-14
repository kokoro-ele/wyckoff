import { Clock3, Sparkles } from "lucide-react";
import { useI18n } from "@/i18n.js";

export function FirstAnalysisNotice({
  open,
  onConfirm,
  onClose,
}: {
  open: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <div className="mobile-modal-backdrop first-analysis-backdrop fixed inset-0 z-[78] flex items-center justify-center bg-ink/35 px-4 backdrop-blur-[3px]" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="first-analysis-title" className="first-analysis-card hand-card w-full max-w-[380px] p-5">
        <div className="first-analysis-icon"><Clock3 size={22} /></div>
        <div className="hand-eyebrow mt-3">FIRST ANALYSIS</div>
        <h2 id="first-analysis-title" className="mt-1 text-[22px] font-semibold">{t("chat.firstRun.title")}</h2>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">{t("chat.firstRun.body")}</p>
        <div className="first-analysis-time"><Clock3 size={14} />{t("chat.firstRun.time")}</div>
        <button type="button" className="hand-btn hand-btn-primary mt-4 w-full px-3 py-2.5 text-sm" onClick={onConfirm}>
          <Sparkles size={14} />
          {t("chat.firstRun.cta")}
        </button>
        <button type="button" className="hand-link mt-2 w-full text-center text-[11px] text-ink-faint" onClick={onClose}>
          {t("chat.firstRun.cancel")}
        </button>
      </section>
    </div>
  );
}
