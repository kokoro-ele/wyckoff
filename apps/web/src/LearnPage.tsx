import { useEffect } from "react";
import { ArrowLeft, ArrowRight, BookOpen, ExternalLink, Languages, Moon, Sun } from "lucide-react";
import { useI18n } from "./i18n.js";
import { useTheme } from "./theme.js";
import { TermDiagram } from "./landing/TermDiagram.js";
import type { TermCode } from "./landing/copy.js";

const TERMS: { code: TermCode; zh: string; en: string; bodyZh: string; bodyEn: string }[] = [
  { code: "Spring", zh: "弹簧", en: "Spring", bodyZh: "跌破区间下沿后快速收回，测试供给是否枯竭。", bodyEn: "Sweeps below support, then closes back inside: a test of supply." },
  { code: "Shakeout", zh: "震仓", en: "Shakeout", bodyZh: "宽价差放量下破，收盘拉回区间，清洗浮筹。", bodyEn: "Wide spread and volume below support, then a recovery." },
  { code: "SOS", zh: "强势信号", en: "Sign of Strength", bodyZh: "放量宽价差越过区间上沿，需求接管。", bodyEn: "A wide-spread, high-volume break above resistance." },
  { code: "LPS", zh: "最后支撑", en: "Last Point of Support", bodyZh: "突破后的更高低点，缩量回踩不破。", bodyEn: "A higher low after the break, on lighter volume." },
  { code: "UT", zh: "上冲回落", en: "Upthrust", bodyZh: "假突破区间上沿，收盘跌回区间内。", bodyEn: "Sweeps above resistance, then closes back inside." },
  { code: "SOW", zh: "弱势信号", en: "Sign of Weakness", bodyZh: "放量跌破区间下沿，供给接管。", bodyEn: "A high-volume break below support." },
];

const LINKS = [
  { labelZh: "Wyckoff Analytics · 方法介绍", labelEn: "Wyckoff Analytics · Method", href: "https://www.wyckoffanalytics.com/wyckoff-method/" },
  { labelZh: "Wikipedia · Wyckoff method", labelEn: "Wikipedia · Wyckoff method", href: "https://en.wikipedia.org/wiki/Wyckoff_method" },
  { labelZh: "完整事件目录（英文）", labelEn: "Full event catalog (English)", href: "/wyckoff.html" },
];

export function LearnPage({ pathLang }: { pathLang: "zh" | "en" }) {
  const { lang, setLang } = useI18n();
  const { theme, setPreference } = useTheme();
  const zh = lang === "zh";
  const dark = theme === "dark";

  useEffect(() => {
    if (lang !== pathLang) setLang(pathLang);
  }, [lang, pathLang, setLang]);

  useEffect(() => {
    document.title = zh ? "Wyckoff 学习页 · EasyWyckoff" : "Learn Wyckoff · EasyWyckoff";
  }, [zh]);

  const switchLanguage = () => {
    const next = lang === "zh" ? "en" : "zh";
    setLang(next);
    window.history.replaceState(null, "", `/learn/${next}`);
  };

  return (
    <div className="learn-shell">
      <header className="learn-topbar">
        <a className="site-brand" href="/"><span className="site-brand-mark">W</span>EasyWyckoff</a>
        <div className="flex items-center gap-2">
          <a className="hand-btn px-3 py-1.5 text-xs" href={`/learn/${lang}`}><BookOpen size={13} />{zh ? "学习中" : "Learning"}</a>
          <button type="button" className="site-lang" onClick={switchLanguage}><Languages size={13} />{zh ? "English" : "中文"}</button>
          <button type="button" className="site-icon" onClick={() => setPreference(dark ? "light" : "dark")}>{dark ? <Sun size={15} /> : <Moon size={15} />}</button>
        </div>
      </header>

      <main className="learn-main">
        <a className="hand-link inline-flex items-center gap-1 text-xs" href="/"><ArrowLeft size={13} />{zh ? "返回首页" : "Back home"}</a>
        <div className="site-kicker mt-5">WYCKOFF · FIELD NOTES</div>
        <h1>{zh ? "Wyckoff 方法：先看结构，再谈方向" : "The Wyckoff Method: structure before direction"}</h1>
        <p className="learn-intro">
          {zh
            ? "Wyckoff 不预测消息，它读价格和成交量留下的痕迹：谁在吸筹、谁在派发、区间是否扎实。下面是最常用的词汇和示意图。"
            : "Wyckoff does not predict headlines. It reads the footprints left by price and volume: who is accumulating, who is distributing, and whether the range is sound. Start with the vocabulary and diagrams."}
        </p>

        <div className="learn-links">
          {LINKS.map((link) => (
            <a key={link.href} className="hand-btn px-3 py-2 text-xs" href={link.href} target={link.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
              <ExternalLink size={13} />{zh ? link.labelZh : link.labelEn}<ArrowRight size={12} />
            </a>
          ))}
        </div>

        <section className="learn-section">
          <div className="learn-section-head"><span>01</span><h2>{zh ? "三条法则" : "Three laws"}</h2></div>
          <div className="learn-grid">
            {[
              [zh ? "供需" : "Supply & demand", zh ? "价格移动，是因为一方更急；量能是紧迫程度的证据。" : "Price moves when one side is more urgent. Volume is evidence."],
              [zh ? "因果" : "Cause & effect", zh ? "区间积累“因”，突破和趋势是“果”。" : "A range builds the cause; the breakout is the effect."],
              [zh ? "努力与结果" : "Effort vs result", zh ? "量能是努力，价差和收盘位置是结果。" : "Volume is effort; spread and close are the result."],
            ].map(([title, body]) => (
              <article key={title} className="hand-card learn-card"><h3>{title}</h3><p>{body}</p></article>
            ))}
          </div>
        </section>

        <section className="learn-section">
          <div className="learn-section-head"><span>02</span><h2>{zh ? "市场周期" : "Market cycle"}</h2></div>
          <div className="learn-cycle">
            {[
              [zh ? "吸筹" : "Accumulation", "A–C", zh ? "下跌后的横盘，清洗浮筹。" : "A range after a decline; weak hands are flushed."],
              [zh ? "上涨" : "Markup", "D–E", zh ? "SOS 跳过小溪，LPS 回踩确认。" : "SOS jumps the Creek; LPS confirms the higher low."],
              [zh ? "派发" : "Distribution", "A–C", zh ? "上涨后的横盘，制造假突破。" : "A range after a rally; traps late buyers."],
              [zh ? "下跌" : "Markdown", "D–E", zh ? "SOW 跌破冰面，反弹失败。" : "SOW breaks the Ice; rallies fail."],
            ].map(([name, phase, body], index) => (
              <article key={name} className={`learn-cycle-card learn-cycle-${index}`}><span>Phase {phase}</span><h3>{name}</h3><p>{body}</p></article>
            ))}
          </div>
        </section>

        <section className="learn-section">
          <div className="learn-section-head"><span>03</span><h2>{zh ? "六个核心动作" : "Six core actions"}</h2></div>
          <p className="learn-sub">{zh ? "示意图只画结构，不构成交易信号。" : "Schematic shapes, not trade signals."}</p>
          <div className="learn-term-grid">
            {TERMS.map((term) => (
              <article key={term.code} className="hand-card learn-term">
                <div className="learn-term-head"><span>{term.code}</span><h3>{zh ? term.zh : term.en}</h3></div>
                <TermDiagram code={term.code} />
                <p>{zh ? term.bodyZh : term.bodyEn}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="learn-section learn-more">
          <h2>{zh ? "继续阅读" : "Keep reading"}</h2>
          <p>{zh ? "官网和 Wikipedia 适合补历史背景；工作台的完整事件目录适合查代号和阶段。" : "Use the official site and Wikipedia for history; the full event catalog is best for code and phase lookup."}</p>
          <div className="learn-links">
            {LINKS.map((link) => (
              <a key={link.href} className="hand-btn px-3 py-2 text-xs" href={link.href} target={link.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
                <ExternalLink size={13} />{zh ? link.labelZh : link.labelEn}
              </a>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
