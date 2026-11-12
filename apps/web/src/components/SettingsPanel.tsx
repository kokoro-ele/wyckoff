import { X } from "lucide-react";
import { ThemeSelector } from "../theme.js";
import { useI18n } from "../i18n.js";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { t, lang, setLang } = useI18n();
  return (
    <div
      className="mobile-modal-backdrop fixed inset-0 z-50 flex items-start justify-center bg-ink/35 px-4 pt-[10vh] backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="settings-title" className="hand-card w-full max-w-[420px] p-5">
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
      </section>
    </div>
  );
}
