import { ArrowRight, BookOpen, Languages, Moon, Sun } from "lucide-react";
import { useI18n } from "../i18n.js";
import { useTheme } from "../theme.js";
import { landingCopy } from "./copy.js";
import { landingCase } from "./cases.js";
import { CaseChart } from "./CaseChart.js";
import { SEO_ORIGIN, useSeo } from "@/lib/seo.js";
import { TermDiagram } from "./TermDiagram.js";

export function LandingPage() {
  const { lang, setLang } = useI18n();
  const { theme, setPreference } = useTheme();
  const copy = landingCopy[lang];
  const dark = theme === "dark";
  const invite =
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("invite");
  const appHref = invite ? `/app?start=1&invite=${encodeURIComponent(invite)}` : "/app?start=1";

  useSeo({
    title: lang === "zh" ? "EasyWyckoff · Wyckoff 市场结构与交易计划" : "EasyWyckoff · Wyckoff structure and trade plans",
    description:
      lang === "zh"
        ? "用 K 线、成交量、区间和收盘位置阅读 Wyckoff 市场结构；Agent 生成带证据的交易计划。"
        : "Read Wyckoff market structure through candles, volume, ranges and closes; the Agent builds evidence-backed trade plans.",
    path: "/",
    lang,
    alternates: [
      { hreflang: "zh-CN", href: `${SEO_ORIGIN}/` },
      { hreflang: "en", href: `${SEO_ORIGIN}/?lang=en` },
      { hreflang: "x-default", href: `${SEO_ORIGIN}/` },
    ],
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "EasyWyckoff",
        url: SEO_ORIGIN,
        logo: `${SEO_ORIGIN}/favicon.svg`,
      },
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "EasyWyckoff",
        url: SEO_ORIGIN,
      },
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "EasyWyckoff",
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        url: `${SEO_ORIGIN}/app`,
        description: "Wyckoff market-structure research workbench with AI-assisted chart reading and structured trade plans.",
      },
    ],
  });

  return (
    <div className={`site-shell site-home${lang === "en" ? " site-home-lang-en" : ""}`}>
      <header className="site-topbar site-home-topbar">
        <a className="site-brand" href="/">
          <span className="site-brand-mark">W</span>
          <span>{copy.brand}</span>
        </a>
        <div className="site-actions">
          <button
            type="button"
            className="site-lang"
            onClick={() => setLang(lang === "zh" ? "en" : "zh")}
            aria-label="Switch language"
          >
            <Languages size={13} />
            <span>{copy.language}</span>
          </button>
          <button
            type="button"
            className="site-icon"
            onClick={() => setPreference(dark ? "light" : "dark")}
            aria-label="Switch theme"
          >
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      <main className="site-home-main">
        <section className="site-home-hero">
          <div className="site-home-copy">
            <div className="site-kicker">{copy.hero.kicker}</div>
            <h1 className={`site-home-title${lang === "en" ? " site-home-title-en" : ""}`}>{copy.hero.title}</h1>
            <div className="site-home-actions">
              <a className="hand-btn hand-btn-primary" href={appHref}>
                {copy.hero.cta}
                <ArrowRight size={15} />
              </a>
              <a className="hand-btn" href={`/learn/${lang}`}>
                <BookOpen size={14} />
                {copy.hero.learn}
              </a>
            </div>
          </div>

          <figure className="site-home-chart hand-card">
            <div className="site-home-chart-head">
              <span className="font-mono text-[10px] font-semibold">{copy.hero.symbol}</span>
              <span>{copy.hero.window}</span>
            </div>
            <CaseChart study={landingCase} labels={copy.chart} zoneLabel={copy.hero.zoneLabel} />
          </figure>
        </section>

        <section id="glossary" className="site-glossary">
          <div className="site-glossary-head">
            <div>
              <div className="site-kicker">{copy.glossary.kicker}</div>
              <h2>{copy.glossary.title}</h2>
            </div>
            <div className="site-glossary-links">
              <a className="site-glossary-more" href={`/learn/${lang}`}>
                {copy.glossary.more}
                <ArrowRight size={12} />
              </a>
            </div>
          </div>

          <div className="site-term-grid">
            {copy.glossary.terms.map((term) => (
              <article key={term.code} className="site-term hand-card">
                <div className="site-term-head">
                  <span className="site-term-code">{term.code}</span>
                  <h3>{term.name}</h3>
                </div>
                <TermDiagram code={term.code} />
                <p>{term.body}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="site-home-footer">
        <span>{copy.footer}</span>
        <nav className="site-legal-links" aria-label="Legal">
          <a href="/privacy">{lang === "zh" ? "隐私政策" : "Privacy"}</a>
          <a href="/terms">{lang === "zh" ? "服务条款" : "Terms"}</a>
          <a href="/refund">{lang === "zh" ? "退款政策" : "Refunds"}</a>
          <a href="/contact">{lang === "zh" ? "联系我们" : "Contact"}</a>
        </nav>
      </footer>
    </div>
  );
}
