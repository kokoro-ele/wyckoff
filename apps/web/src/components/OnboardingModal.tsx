import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, KeyRound, Search, Sparkles, X } from "lucide-react";
import * as api from "@/lib/api.js";
import { useAuth } from "@/auth/AuthProvider.js";
import { useI18n } from "@/i18n.js";

const STEPS = {
  zh: [
    { icon: Search, title: "找一只标的", body: "点顶部「搜索」或 ⌘K，支持代码、中文名、拼音和美股英文名。选中后图表会自动切换。" },
    { icon: BookOpen, title: "先看结构", body: "左边自选、中间 K 线、右边研究面板。基础面和行情免费看；学习页把 Wyckoff 的名词和示意图分开讲。" },
    { icon: Sparkles, title: "让 Agent 分析", body: "打开 Agent，点「自动分析」或直接提问。Agent 会读区间、量价、支撑阻力，并把交易计划保存到研究面板。" },
    { icon: KeyRound, title: "选择模型", body: "设置里可以选平台模型或自己的模型。用自己的模型不消耗平台分析次数；Key 只保存在加密工作区。" },
  ],
  en: [
    { icon: Search, title: "Find a symbol", body: "Use Search or ⌘K. Codes, Chinese names, pinyin and English US names all work; the chart switches after you pick one." },
    { icon: BookOpen, title: "Read the structure", body: "Watchlist on the left, chart in the middle, research on the right. Quotes and fundamentals are free; the Learn page explains Wyckoff terms." },
    { icon: Sparkles, title: "Ask the Agent", body: "Open Agent and tap Auto analyze or ask a question. It reads ranges, volume, support/resistance and saves a trade plan to Research." },
    { icon: KeyRound, title: "Choose a model", body: "Use the platform model or your own. Your own key does not consume platform credits and stays in your encrypted workspace." },
  ],
} as const;

export function OnboardingModal() {
  const { lang } = useI18n();
  const { isVerified } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!isVerified) return;
    let cancelled = false;
    void api.fetchOnboarding().then(({ seen }) => {
      if (!cancelled && !seen) setOpen(true);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [isVerified]);

  const finish = () => {
    setOpen(false);
    void api.completeOnboarding().catch(() => undefined);
  };

  if (!open) return null;
  const copy = STEPS[lang];
  const current = copy[step] ?? copy[0];
  const Icon = current.icon;
  const last = step === copy.length - 1;

  return (
    <div className="onboarding-backdrop">
      <section className="onboarding-card hand-card" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <button type="button" className="hand-icon onboarding-close" aria-label="Close" onClick={finish}><X size={16} /></button>
        <div className="onboarding-kicker">GETTING STARTED · {step + 1}/{copy.length}</div>
        <div className="onboarding-icon"><Icon size={24} /></div>
        <h2 id="onboarding-title">{current.title}</h2>
        <p>{current.body}</p>
        <div className="onboarding-dots">{copy.map((_, index) => <i key={index} className={index === step ? "active" : ""} />)}</div>
        <div className="onboarding-actions">
          <button type="button" className="hand-link" onClick={finish}>{lang === "zh" ? "跳过" : "Skip"}</button>
          <button type="button" className="hand-btn hand-btn-primary px-3 py-2 text-xs" onClick={() => last ? finish() : setStep(step + 1)}>
            {last ? (lang === "zh" ? "开始使用" : "Start using") : (lang === "zh" ? "下一步" : "Next")}
            <ArrowRight size={13} />
          </button>
        </div>
      </section>
    </div>
  );
}
