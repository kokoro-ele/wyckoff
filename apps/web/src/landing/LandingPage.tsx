import { ArrowRight, BookOpen, Bug, Languages, Moon, Sun } from "lucide-react";
import { useI18n } from "../i18n.js";
import { useTheme } from "../theme.js";
import { landingCopy } from "./copy.js";
import { landingCase } from "./cases.js";
import { CaseChart } from "./CaseChart.js";
import { SEO_ORIGIN, useSeo } from "@/lib/seo.js";

export function LandingPage() {
  const { lang, setLang } = useI18n();
  const { theme, setPreference } = useTheme();
  const copy = landingCopy[lang];
  const dark = theme === "dark";
  const labels =
    lang === "zh"
      ? { phase: "阶段", range: "区间", bias: "偏向", trigger: "触发", entry: "入场区", stop: "止损", targets: "目标", invalidation: "失效" }
      : { phase: "Phase", range: "Range", bias: "Bias", trigger: "Trigger", entry: "Entry", stop: "Stop", targets: "Targets", invalidation: "Invalidation" };
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
          <a className="site-icon" href="/app?bug=1" aria-label={copy.bug} title={copy.bug}><Bug size={15} /></a>
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

        <section id="sample" className="site-sample">
          <div className="site-section-head">
            <div className="site-kicker">{copy.sample.kicker}</div>
            <h2>{copy.sample.title}</h2>
            <p>{copy.sample.intro}</p>
          </div>
          <div className="site-sample-grid">
            <article className="site-sample-thesis hand-card">
              <div className="site-sample-meta">{copy.sample.window}</div>
              <h3>{copy.sample.thesis}</h3>
              <dl className="site-sample-facts">
                <div><dt>{labels.phase}</dt><dd>{copy.sample.phase}</dd></div>
                <div><dt>{labels.range}</dt><dd>{copy.sample.range}</dd></div>
                <div><dt>{labels.bias}</dt><dd>{copy.sample.bias}</dd></div>
                <div><dt>{labels.invalidation}</dt><dd>{copy.sample.invalidation}</dd></div>
              </dl>
              <p className="site-sample-levels">{copy.sample.levels}</p>
            </article>
            <article className="site-sample-plan hand-card">
              <div className="site-plan-kicker">TRADE PLAN · NVDA.US</div>
              {[
                [labels.trigger, copy.sample.trigger],
                [labels.entry, copy.sample.entry],
                [labels.stop, copy.sample.stop],
                [labels.targets, copy.sample.targets],
                [labels.invalidation, copy.sample.invalidation],
              ].map(([label, value]) => (
                <div className="site-plan-row" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
              <p className="site-sample-note">{copy.sample.note}</p>
            </article>
          </div>
          <div className="site-sample-foot">
            <span>{copy.sample.note}</span>
            <a className="hand-btn hand-btn-primary" href={appHref}>{copy.sample.cta}<ArrowRight size={14} /></a>
          </div>
        </section>

        <section className="site-features">
          <div className="site-section-head">
            <div className="site-kicker">{copy.features.kicker}</div>
            <h2>{copy.features.title}</h2>
          </div>
          <ul className="site-feature-list">
            {copy.features.items.map((item) => <li key={item}><span>✦</span>{item}</li>)}
          </ul>
        </section>

        <section className="site-pricing">
          <div className="site-section-head">
            <div className="site-kicker">{copy.pricing.kicker}</div>
            <h2>{copy.pricing.title}</h2>
            <p>{copy.pricing.intro}</p>
          </div>
          <div className="site-pricing-grid">
            <article className="site-price-card hand-card">
              <span className="site-price-tag">FREE</span>
              <strong>{copy.pricing.free}</strong>
              <p>{copy.pricing.daily}</p>
            </article>
            <article className="site-price-card hand-card site-price-featured">
              <span className="site-price-tag">STARTER</span>
              <strong>{copy.pricing.packs.split(" · ")[0]}</strong>
              <p>{copy.pricing.billing}</p>
            </article>
            <article className="site-price-card hand-card">
              <span className="site-price-tag">PRO</span>
              <strong>{copy.pricing.packs.split(" · ")[1]}</strong>
              <p>{copy.pricing.billing}</p>
            </article>
          </div>
          <div className="site-pricing-cta">
            <a className="hand-btn hand-btn-primary" href={appHref}>{copy.pricing.cta}<ArrowRight size={14} /></a>
          </div>
        </section>

        <section className="site-faq">
          <div className="site-section-head">
            <div className="site-kicker">{copy.faq.kicker}</div>
            <h2>{copy.faq.title}</h2>
          </div>
          <div className="site-faq-list">
            {copy.faq.items.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section id="method" className="site-method">
          <div className="site-method-copy">
            <div className="site-kicker">{copy.method.kicker}</div>
            <h2>{copy.method.title}</h2>
            <p>{copy.method.body}</p>
          </div>
          <a
            className="site-method-link hand-btn"
            href="https://www.wyckoffanalytics.com/wyckoff-method/"
            target="_blank"
            rel="noreferrer"
          >
            {copy.method.link}
            <ArrowRight size={13} />
          </a>
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
