import { useEffect } from "react";
import { ArrowRight, Languages, Moon, Sun } from "lucide-react";
import { useI18n } from "../i18n.js";
import { useTheme } from "../theme.js";
import { landingCopy } from "./copy.js";
import { landingCase } from "./cases.js";
import { CaseChart } from "./CaseChart.js";
import { TermDiagram } from "./TermDiagram.js";

export function LandingPage() {
  const { lang, setLang } = useI18n();
  const { theme, setPreference } = useTheme();
  const copy = landingCopy[lang];
  const dark = theme === "dark";
  const invite =
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("invite");
  const appHref = invite ? `/app?invite=${encodeURIComponent(invite)}` : "/app";

  useEffect(() => {
    document.title =
      lang === "zh" ? "EasyWyckoff · 看见价格背后的结构" : "EasyWyckoff · See the structure behind the price";
  }, [lang]);

  return (
    <div className="site-shell site-home">
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
            <h1 className="site-home-title">{copy.hero.title}</h1>
            <p className="site-home-subtitle">{copy.hero.subtitle}</p>
            <div className="site-home-actions">
              <a className="hand-btn hand-btn-primary" href={appHref}>
                {copy.hero.cta}
                <ArrowRight size={15} />
              </a>
            </div>
            <p className="site-home-note">{copy.hero.note}</p>
          </div>

          <figure className="site-home-chart hand-card">
            <div className="site-home-chart-head">
              <span className="font-mono text-[10px] font-semibold">{copy.hero.symbol}</span>
              <span>{copy.hero.window}</span>
            </div>
            <CaseChart study={landingCase} labels={copy.chart} zoneLabel={copy.hero.zoneLabel} />
            <figcaption>{copy.hero.chartCaption}</figcaption>
          </figure>
        </section>

        <section id="glossary" className="site-glossary">
          <div className="site-glossary-head">
            <div>
              <div className="site-kicker">{copy.glossary.kicker}</div>
              <h2>{copy.glossary.title}</h2>
              <p>{copy.glossary.intro}</p>
            </div>
            <span className="site-glossary-note">{copy.glossary.note}</span>
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

      <footer className="site-home-footer">{copy.footer}</footer>
    </div>
  );
}
