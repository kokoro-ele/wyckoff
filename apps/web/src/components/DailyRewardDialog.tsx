import { Gift, Sparkles, X } from "lucide-react";
import { useI18n } from "@/i18n.js";

export function DailyRewardDialog({
  reward,
  onClose,
}: {
  reward: { amount: number; balance: number } | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  if (!reward) return null;
  return (
    <div className="mobile-modal-backdrop fixed inset-0 z-[65] flex items-center justify-center bg-ink/35 px-4 backdrop-blur-[3px]" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="daily-reward-title" className="daily-reward-card hand-card w-full max-w-[360px] p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="daily-reward-icon"><Gift size={22} /></div>
          <button type="button" className="hand-icon" aria-label={t("action.close")} onClick={onClose}><X size={16} /></button>
        </div>
        <div className="hand-eyebrow mt-3">DAILY · REWARD</div>
        <h2 id="daily-reward-title" className="mt-1 text-[22px] font-semibold">{t("daily.title")}</h2>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">{t("daily.body", { amount: reward.amount })}</p>
        <div className="daily-reward-amount">
          <Sparkles size={14} />
          <strong>+{reward.amount}</strong>
          <span>{t("common.credits")}</span>
        </div>
        <p className="mt-2 text-[11px] text-ink-faint">{t("daily.balance", { n: reward.balance })}</p>
        <button type="button" className="hand-btn hand-btn-primary mt-4 w-full px-3 py-2.5 text-sm" onClick={onClose}>
          {t("daily.cta")}
        </button>
      </section>
    </div>
  );
}
