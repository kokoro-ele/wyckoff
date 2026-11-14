import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, ExternalLink, Languages, Moon, Sun } from "lucide-react";
import { useI18n } from "./i18n.js";
import { SEO_ORIGIN, useSeo } from "./lib/seo.js";
import { useTheme } from "./theme.js";
import { WYCKOFF_EVENTS, WYCKOFF_EVENT_CODES, type WyckoffEventCode, type WyckoffSide } from "@wyckoff/shared";

const LINKS = [
  { labelZh: "Wyckoff Analytics · 方法介绍", labelEn: "Wyckoff Analytics · Method", href: "https://www.wyckoffanalytics.com/wyckoff-method/" },
  { labelZh: "Google · Wyckoff events and phases", labelEn: "Google · Wyckoff events and phases", href: "https://www.google.com/search?q=wyckoff+events+and+phases" },
  { labelZh: "完整事件目录（本页）", labelEn: "Full event catalog (this page)", href: "#events" },
];

const EVENT_EN: Record<WyckoffEventCode, string> = {
  PS: "First notable support on expanding volume and spread during a decline; large operators begin to bid, but this is usually not the low.",
  SC: "Panic extreme: huge volume, wide spread and a close well off the low. Heavy absorption leaves a footprint.",
  AR: "The automatic rally after selling (or the reaction after buying) is exhausted. Its end defines a range boundary.",
  ST: "Return to the climax area to test supply and demand. Volume and spread should contract if the prior effort is spent.",
  Spring: "A brief break below range support, followed by a fast reclaim. It flushes weak hands and is the Phase C test.",
  Shakeout: "A more violent Spring: a sharp, high-volume break below support that is quickly recovered.",
  Test: "A quiet retest of a prior low or high. Ideally low volume, narrow spread and a close back in favor.",
  SOS: "A wide-spread rally on expanding volume through range resistance; demand takes control and Phase D begins.",
  LPS: "A low-volume pullback after SOS that holds a higher low. A classic lower-risk long setup.",
  JAC: "A decisive move across the Creek, the resistance line along the range highs; the pictorial SOS.",
  BU: "The pullback after JAC, where old resistance becomes new support.",
  PSY: "The first volume stall in an advance. Distribution begins, but the top is not necessarily in yet.",
  BC: "A climactic high-volume up-bar that fails to hold. The Composite Man sells into late demand.",
  UT: "A break above resistance that immediately falls back inside the range: a failed breakout.",
  UTAD: "The final bull trap after distribution is built, followed by a fast failure. It is the Phase C test.",
  SOW: "A wide-spread decline on expanding volume through range support; supply is in control.",
  LPSY: "A weak rally after SOW that makes a lower high; a lower-risk short or exit.",
  ICE: "A break below the Ice, the support line along range lows, often followed by a throwback.",
};

const SIDE_LABEL: Record<WyckoffSide, { zh: string; en: string }> = {
  accumulation: { zh: "吸筹事件", en: "Accumulation events" },
  distribution: { zh: "派发事件", en: "Distribution events" },
  both: { zh: "两类结构共有", en: "Shared events" },
};

export function LearnPage({ pathLang }: { pathLang: "zh" | "en" }) {
  const { setLang } = useI18n();
  const { theme, setPreference } = useTheme();
  const [pageLang, setPageLang] = useState<"zh" | "en">(pathLang);
  const zh = pageLang === "zh";
  const dark = theme === "dark";

  useEffect(() => {
    setPageLang(pathLang);
    setLang(pathLang);
  }, [pathLang, setLang]);

  useSeo({
    title: zh ? "Wyckoff 方法学习 · 三大法则与市场周期 | EasyWyckoff" : "Learn the Wyckoff Method · Three laws and market cycle | EasyWyckoff",
    description: zh
      ? "用中英文理解 Wyckoff 的三大法则、市场周期和 Composite Man，并通过外部资料继续研究 events 与 phases。"
      : "Understand Wyckoff's three laws, market cycle and Composite Man, then continue with external references for events and phases.",
    path: `/learn/${pageLang}`,
    lang: zh ? "zh" : "en",
    alternates: [
      { hreflang: "zh-CN", href: `${SEO_ORIGIN}/learn/zh` },
      { hreflang: "en", href: `${SEO_ORIGIN}/learn/en` },
      { hreflang: "x-default", href: `${SEO_ORIGIN}/learn/en` },
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "LearningResource",
        name: zh ? "Wyckoff 方法学习页" : "Learn the Wyckoff Method",
        description: zh ? "Wyckoff 三大法则、市场周期与 Composite Man。" : "Wyckoff laws, market cycle and the Composite Man.",
        inLanguage: zh ? "zh-CN" : "en",
        learningResourceType: "Guide",
        isAccessibleForFree: true,
        url: `${SEO_ORIGIN}/learn/${pageLang}`,
      },
    ],
  });

  const switchLanguage = () => {
    const next = pageLang === "zh" ? "en" : "zh";
    setPageLang(next);
    setLang(next);
    window.history.replaceState(null, "", `/learn/${next}`);
  };

  return (
    <div className="learn-shell">
      <header className="learn-topbar">
        <a className="site-brand" href="/"><span className="site-brand-mark">W</span>EasyWyckoff</a>
        <div className="flex items-center gap-2">
          <a className="hand-btn px-3 py-1.5 text-xs" href={`/learn/${pageLang}`}><BookOpen size={13} />{zh ? "学习中" : "Learning"}</a>
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
            ? "Wyckoff 不预测消息，它读价格和成交量留下的痕迹：谁在吸筹、谁在派发、区间是否扎实。先理解三大法则和市场周期，再通过外部资料深入事件与阶段。"
            : "Wyckoff does not predict headlines. It reads the footprints left by price and volume: who is accumulating, who is distributing, and whether the range is sound. Start with the three laws and the market cycle, then use the external references for events and phases."}
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

        <section id="events" className="learn-section">
          <div className="learn-section-head"><span>03</span><h2>{zh ? "事件目录" : "Event catalog"}</h2></div>
          <p className="learn-events-intro">
            {zh
              ? "事件不是孤立信号。先确认交易区间和阶段，再用量能、价差与收盘位置确认事件是否成立。"
              : "Events are not standalone signals. Confirm the range and phase first, then validate an event with volume, spread and the close."}
            {" "}
            <a href="https://www.wyckoffanalytics.com/wyckoff-method/" target="_blank" rel="noreferrer">
              {zh ? "查看 Wyckoff Analytics 的完整方法说明 →" : "Read the full method at Wyckoff Analytics →"}
            </a>
          </p>
          <div className="learn-event-groups">
            {(["accumulation", "distribution", "both"] as WyckoffSide[]).map((side) => {
              const codes = WYCKOFF_EVENT_CODES.filter((code) => WYCKOFF_EVENTS[code].side === side);
              return (
                <section key={side} className="learn-event-group">
                  <h3>{zh ? SIDE_LABEL[side].zh : SIDE_LABEL[side].en}</h3>
                  <div className="learn-event-table-wrap">
                    <table className="learn-event-table">
                      <thead>
                        <tr>
                          <th>{zh ? "代号" : "Code"}</th>
                          <th>{zh ? "名称" : "Name"}</th>
                          <th>{zh ? "阶段" : "Phase"}</th>
                          <th>{zh ? "含义" : "Meaning"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {codes.map((code) => {
                          const meta = WYCKOFF_EVENTS[code];
                          return (
                            <tr key={code}>
                              <td data-label={zh ? "代号" : "Code"}><code>{meta.code}</code></td>
                              <td data-label={zh ? "名称" : "Name"}>{zh ? meta.nameZh : meta.nameEn}</td>
                              <td data-label={zh ? "阶段" : "Phase"} className="learn-event-phases">{meta.phases.join(", ")}</td>
                              <td data-label={zh ? "含义" : "Meaning"}>{zh ? meta.description : EVENT_EN[code]}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </div>
        </section>

        <section className="learn-section learn-more">
          <h2>{zh ? "继续阅读" : "Keep reading"}</h2>
          <p>{zh ? "Wyckoff Analytics 和 Google 搜索适合继续研究事件与阶段；工作台的完整事件目录适合查代号。" : "Use Wyckoff Analytics and the Google search for events and phases; the full event catalog is best for code lookup."}</p>
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
