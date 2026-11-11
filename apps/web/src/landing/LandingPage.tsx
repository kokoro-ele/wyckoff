import { useEffect } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  Languages,
  LineChart,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  WalletCards,
} from "lucide-react";
import { useI18n } from "../i18n.js";
import { useTheme } from "../theme.js";
import { landingCopy } from "./copy.js";
import { landingCases } from "./cases.js";
import { CaseChart } from "./CaseChart.js";

const featureIcons = [LineChart, Sparkles, WalletCards, ShieldCheck];

export function LandingPage() {
  const { lang, setLang } = useI18n();
  const { theme, setPreference } = useTheme();
  const copy = landingCopy[lang];
  const dark = theme === "dark";

  useEffect(() => {
    document.title =
      lang === "zh" ? "EasyWyckoff · 看见价格背后的结构" : "EasyWyckoff · See the structure behind the price";
  }, [lang]);

  return (
    <div className="site-shell">
      <header className="site-topbar">
        <a className="site-brand" href="/">
          <span className="site-brand-mark">W</span>
          <span>EasyWyckoff</span>
        </a>
        <nav className="site-nav" aria-label="Primary">
          <a href="#method">{copy.nav.method}</a>
          <a href="#cases">{copy.nav.cases}</a>
          <a href="#workbench">{copy.nav.workbench}</a>
          <a href="#credits">{copy.nav.credits}</a>
        </nav>
        <div className="site-actions">
          <button type="button" className="site-lang" onClick={() => setLang(lang === "zh" ? "en" : "zh")} aria-label="Switch language">
            <Languages size={13} />
            <span>{copy.nav.language}</span>
          </button>
          <button type="button" className="site-icon" onClick={() => setPreference(dark ? "light" : "dark")} aria-label="Switch theme">
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <a className="hand-btn hand-btn-primary site-open" href="/app">
            <span>{copy.nav.open}</span>
            <ArrowRight size={14} />
          </a>
        </div>
      </header>

      <main>
        <section className="site-hero">
          <div className="site-hero-copy">
            <div className="site-kicker">{copy.hero.kicker}</div>
            <h1 className="site-hero-title">{copy.hero.title}</h1>
            <p className="site-hero-subtitle">{copy.hero.subtitle}</p>
            <div className="site-hero-actions">
              <a className="hand-btn hand-btn-primary" href="/app">
                {copy.hero.primary}
                <ArrowRight size={15} />
              </a>
              <a className="hand-btn" href="#method">
                <BookOpen size={14} />
                {copy.hero.secondary}
              </a>
            </div>
            <div className="site-hero-notes">
              <span><Check size={12} /> {copy.hero.noteFree}</span>
              <span><Check size={12} /> {copy.hero.noteBrowse}</span>
            </div>
          </div>

          <div className="site-hero-visual">
            <figure className="site-hero-chart hand-card">
              <div className="site-hero-chart-head">
                <span className="font-mono text-[11px] font-semibold">AAPL.US</span>
                <span>{copy.cases.aapl.window}</span>
              </div>
              <CaseChart study={landingCases[0]!} labels={copy.chart} zoneLabel={copy.cases.aapl.zoneLabel} />
              <figcaption>{copy.hero.shotCaption}</figcaption>
            </figure>
          </div>
        </section>

        <div className="site-strip" aria-label="Product principles">
          {copy.strip.map((item) => (
            <span key={item}><Check size={12} /> {item}</span>
          ))}
        </div>

        <section id="method" className="site-section">
          <div className="site-section-head">
            <div className="site-kicker">{copy.method.kicker}</div>
            <h2>{copy.method.title}</h2>
            <p>{copy.method.intro}</p>
          </div>

          <div className="site-law-grid">
            {copy.method.laws.map((law, index) => (
              <article key={law.title} className="site-law hand-card">
                <span className="site-number">0{index + 1}</span>
                <h3>{law.title}</h3>
                <p>{law.body}</p>
              </article>
            ))}
          </div>

          <div className="site-subhead">
            <h3>{copy.method.cycleTitle}</h3>
            <span className="site-rule" />
          </div>
          <div className="site-cycle">
            {copy.method.cycle.map((phase, index) => (
              <article key={phase.name} className={`site-cycle-card site-cycle-${index}`}>
                <span>{phase.phase}</span>
                <h4>{phase.name}</h4>
                <p>{phase.body}</p>
                {index < copy.method.cycle.length - 1 && <ArrowRight className="site-cycle-arrow" size={17} />}
              </article>
            ))}
          </div>

          <div className="site-subhead">
            <h3>{copy.method.eventsTitle}</h3>
            <span className="site-rule" />
          </div>
          <div className="site-event-grid">
            {copy.method.events.map((event) => (
              <article key={event.code} className="site-event hand-card">
                <span className="site-event-code">{event.code}</span>
                <h4>{event.name}</h4>
              </article>
            ))}
          </div>

          <div className="site-section-cta">
            <a className="hand-btn hand-btn-primary" href="/app">
              {copy.method.cta}
              <ArrowRight size={14} />
            </a>
          </div>
        </section>

        <section id="cases" className="site-section site-cases-section">
          <div className="site-section-head">
            <div className="site-kicker">{copy.cases.kicker}</div>
            <h2>{copy.cases.title}</h2>
            <p>{copy.cases.intro}</p>
          </div>
          <div className="site-case-grid">
            {landingCases.map((study) => {
              const caseCopy = copy.cases[study.key];
              return (
                <article key={study.key} className="site-case hand-card">
                  <div className="site-case-chart">
                    <CaseChart study={study} labels={copy.chart} zoneLabel={caseCopy.zoneLabel} />
                  </div>
                  <div className="site-case-body">
                    <div className="site-case-meta">
                      <span className="site-case-tag">{caseCopy.tag}</span>
                      <span className="font-mono text-[9px] text-ink-faint">{caseCopy.window}</span>
                    </div>
                    <h3>{caseCopy.title}</h3>
                    <p>{caseCopy.narrative}</p>
                    <p className="site-case-levels">{caseCopy.levels}</p>
                    <a className="site-text-link" href={`/app?symbol=${encodeURIComponent(study.symbol)}`}>
                      {copy.chart.open} <ArrowRight size={13} />
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="site-data-note">{copy.cases.dataNote} · {copy.cases.disclaimer}</p>
        </section>

        <section id="workbench" className="site-section site-workbench">
          <div className="site-workbench-copy">
            <div className="site-kicker">{copy.workbench.kicker}</div>
            <h2>{copy.workbench.title}</h2>
            <p>{copy.workbench.body}</p>
            <div className="site-feature-grid">
              {copy.workbench.features.map((feature, index) => {
                const Icon = featureIcons[index] ?? Sparkles;
                return (
                  <article key={feature.title} className="site-feature">
                    <Icon size={18} />
                    <h4>{feature.title}</h4>
                    <p>{feature.body}</p>
                  </article>
                );
              })}
            </div>
            <a className="hand-btn hand-btn-primary mt-5" href="/app">
              {copy.workbench.cta}
              <ArrowRight size={14} />
            </a>
          </div>
          <figure className="site-workbench-shot hand-card">
            <img
              src={lang === "zh" ? "/marketing/workbench-zh.jpg" : "/marketing/workbench-en.jpg"}
              alt={copy.workbench.imageAlt}
              loading="lazy"
            />
            <figcaption>{copy.hero.shotCaption}</figcaption>
          </figure>
        </section>

        <section id="credits" className="site-section site-credits">
          <div className="site-credits-card hand-card">
            <div>
              <div className="site-kicker">{copy.credits.kicker}</div>
              <h2>{copy.credits.title}</h2>
              <p>{copy.credits.body}</p>
              <a className="hand-btn hand-btn-primary mt-5" href="/app">
                {copy.credits.cta}
                <ArrowRight size={14} />
              </a>
              <p className="site-credits-note">{copy.credits.note}</p>
            </div>
            <div className="site-credit-stamps">
              <div><strong>3</strong><span>{copy.credits.free}</span></div>
              <div><strong>+3</strong><span>{copy.credits.invite}</span></div>
              <div><strong>∞</strong><span>{copy.credits.packs}</span></div>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div>
          <a className="site-brand" href="/">
            <span className="site-brand-mark">W</span>
            <span>EasyWyckoff</span>
          </a>
          <p>{copy.footer.tagline}</p>
        </div>
        <nav aria-label="Footer">
          <a href="#method">{copy.footer.method}</a>
          <a href="#cases">{copy.footer.cases}</a>
          <a href="#workbench">{copy.footer.workbench}</a>
          <a href="/wyckoff.html">{copy.footer.docs}</a>
          <a href="/app">{copy.nav.open}</a>
        </nav>
        <p className="site-disclaimer">{copy.footer.disclaimer}</p>
        <span className="site-copyright">{copy.footer.copyright}</span>
      </footer>
    </div>
  );
}
