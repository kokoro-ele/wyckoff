import { useEffect, useLayoutEffect, useState } from "react";
import { ArrowRight, BookOpen, KeyRound, Search, Sparkles, X } from "lucide-react";
import * as api from "@/lib/api.js";
import { useAuth } from "@/auth/AuthProvider.js";
import { useI18n } from "@/i18n.js";

const STEPS = {
  zh: [
    { target: "search", icon: Search, title: "从搜索开始", body: "点这里搜索代码、中文名、拼音或美股英文名，选中后图表会切换。" },
    { target: "watchlist", icon: BookOpen, title: "把常看的放进自选", body: "左侧自选会跟随账号同步；分析时可以从这里快速切换标的。" },
    { target: "chart", icon: Sparkles, title: "先看结构，再问 Agent", body: "中间是 K 线。选中一段或一根 K 线后提问，Agent 会围绕你的选择回答。" },
    { target: "analysis", icon: Sparkles, title: "研究与 Agent", body: "右侧有两个标签：研究看基本面和已保存计划，Agent 负责读图、标注和计算计划。" },
    { target: "settings", icon: KeyRound, title: "选择模型", body: "在设置里选平台模型或自己的模型。自己的模型不消耗平台分析次数。" },
  ],
  en: [
    { target: "search", icon: Search, title: "Start with search", body: "Search by code, Chinese name, pinyin or English US name. Picking a result switches the chart." },
    { target: "watchlist", icon: BookOpen, title: "Save it to your watchlist", body: "The left watchlist syncs with your account, so you can switch symbols quickly." },
    { target: "chart", icon: Sparkles, title: "Read the structure first", body: "This is the chart. Select a bar or range, then ask the Agent about that exact area." },
    { target: "analysis", icon: Sparkles, title: "Research and Agent", body: "The right dock has Research for fundamentals and saved plans, and Agent for chart reading and plan calculation." },
    { target: "settings", icon: KeyRound, title: "Choose a model", body: "Use the platform model or your own. Your own model does not consume platform analysis credits." },
  ],
} as const;

type Rect = { left: number; top: number; width: number; height: number };

export function OnboardingModal() {
  const { lang } = useI18n();
  const { isVerified } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!isVerified) return;
    let cancelled = false;
    void api.fetchOnboarding().then(({ seen }) => {
      if (!cancelled && !seen) setOpen(true);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [isVerified]);

  const copy = STEPS[lang];
  const current = copy[step] ?? copy[0];

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const target = document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`);
      if (!target) { setRect(null); return; }
      const r = target.getBoundingClientRect();
      setRect({ left: r.left, top: r.top, width: r.width, height: r.height });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, current.target]);

  const finish = () => {
    setOpen(false);
    void api.completeOnboarding().catch(() => undefined);
  };

  if (!open) return null;
  const Icon = current.icon;
  const tipWidth = 320;
  const left = rect
    ? Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - tipWidth - 12))
    : Math.max(12, (window.innerWidth - tipWidth) / 2);
  const top = rect
    ? Math.min(
        Math.max(12, rect.top + rect.height + 12),
        Math.max(12, window.innerHeight - 190),
      )
    : Math.max(12, window.innerHeight / 2 - 90);

  return (
    <>
      {rect && (
        <div
          className="tour-highlight"
          style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }}
        />
      )}
      <div className="tour-tip hand-card" style={{ left, top, width: tipWidth }} role="dialog" aria-label={current.title}>
        <button type="button" className="hand-icon tour-close" aria-label="Close" onClick={finish}><X size={14} /></button>
        <div className="tour-kicker">GUIDE · {step + 1}/{copy.length}</div>
        <div className="tour-title"><Icon size={16} /><strong>{current.title}</strong></div>
        <p>{current.body}</p>
        <div className="tour-actions">
          <button type="button" className="hand-link" onClick={finish}>{lang === "zh" ? "跳过" : "Skip"}</button>
          <button type="button" className="hand-btn hand-btn-primary px-2.5 py-1.5 text-[11px]" onClick={() => step === copy.length - 1 ? finish() : setStep(step + 1)}>
            {step === copy.length - 1 ? (lang === "zh" ? "完成" : "Done") : (lang === "zh" ? "下一步" : "Next")}
            <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </>
  );
}
