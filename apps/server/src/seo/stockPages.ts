import type { ResearchResponse, ResearchStrategy } from "@wyckoff/shared";
import { getResearch } from "../services/research.js";
import { getKlines, MarketDataError } from "../services/market.js";
import { SEO_TICKERS, findTicker, slugFor, symbolFromSlug, type SeoTicker } from "./tickers.js";

/**
 * Public, server-rendered Wyckoff structure pages (/wyckoff and /wyckoff/:slug).
 *
 * They are built only from the deterministic research engine — no model call —
 * so a crawler visit costs a cached market-data read, and every number on the
 * page can be traced to price and volume. The CDN caches each page for hours.
 */
export const SITE_ORIGIN = "https://easywyckoff.online";
const CACHE_OK = "public, max-age=600, s-maxage=21600, stale-while-revalidate=86400";

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

function money(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const digits = Math.abs(value) >= 100 ? 2 : Math.abs(value) >= 1 ? 2 : 4;
  const prefix = currency === "USD" ? "$" : currency === "CNY" ? "¥" : "";
  return `${prefix}${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const TREND_WORD = { up: "rising", down: "falling", flat: "flat" } as const;
const BIAS_LABEL = { long: "Constructive (long bias)", short: "Weak (short bias)", wait: "Neutral — wait for confirmation" } as const;
const HYPOTHESIS_LABEL: Record<string, string> = {
  accumulation: "possible accumulation (prior trend was down)",
  distribution: "possible distribution (prior trend was up)",
  reaccumulation: "possible re-accumulation inside an uptrend",
  redistribution: "possible re-distribution inside a downtrend",
  unclear: "no clear accumulation or distribution signature yet",
};

function triggerSentence(strategy: ResearchStrategy, currency: string, price: number): string {
  const level = money(strategy.trigger.price, currency);
  const above = strategy.trigger.price !== null && price > strategy.trigger.price;
  switch (strategy.trigger.kind) {
    case "breakout":
      return above
        ? `price holding above ${level} after the breakout (a Back-Up that stays above the old range top)`
        : `a decisive close above ${level} on expanding volume (a Sign of Strength out of the range)`;
    case "reclaim":
      return `price holding above ${level} on a pullback (old resistance acting as support — a Back-Up that holds)`;
    case "breakdown":
      return above
        ? `a decisive close below ${level} on expanding volume (a Sign of Weakness through support)`
        : `a rally that fails below ${level} on light volume (broken support acting as resistance — a weak Last Point of Supply)`;
    case "hold":
    default:
      return `price holding ${level} with shrinking volume on tests (a successful Secondary Test or Spring)`;
  }
}

interface Performance {
  change20: number | null;
  change60: number | null;
  volumeRatio: number | null;
  high52: number | null;
  low52: number | null;
}

async function performance(symbol: string): Promise<Performance> {
  const bars = await getKlines({ symbol, period: "1d", adjust: "forward" });
  const last = bars.at(-1);
  if (!last) return { change20: null, change60: null, volumeRatio: null, high52: null, low52: null };
  const change = (back: number) => {
    const base = bars.at(-1 - back)?.close;
    return base ? ((last.close - base) / base) * 100 : null;
  };
  const recent = bars.slice(-10);
  const before = bars.slice(-60, -10);
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
  const recentVolume = mean(recent.map((bar) => bar.volume));
  const baseVolume = mean(before.map((bar) => bar.volume));
  const year = bars.slice(-252);
  return {
    change20: change(20),
    change60: change(60),
    volumeRatio: baseVolume > 0 ? recentVolume / baseVolume : null,
    high52: year.length ? Math.max(...year.map((bar) => bar.high)) : null,
    low52: year.length ? Math.min(...year.map((bar) => bar.low)) : null,
  };
}

function layout(options: {
  title: string;
  description: string;
  canonical: string;
  body: string;
  jsonLd: unknown[];
  noindex?: boolean;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(options.title)}</title>
<meta name="description" content="${escapeHtml(options.description)}" />
<meta name="robots" content="${options.noindex ? "noindex,follow" : "index,follow,max-image-preview:large"}" />
<link rel="canonical" href="${escapeHtml(options.canonical)}" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="EasyWyckoff" />
<meta property="og:title" content="${escapeHtml(options.title)}" />
<meta property="og:description" content="${escapeHtml(options.description)}" />
<meta property="og:url" content="${escapeHtml(options.canonical)}" />
<meta property="og:image" content="${SITE_ORIGIN}/og.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(options.title)}" />
<meta name="twitter:description" content="${escapeHtml(options.description)}" />
<meta name="twitter:image" content="${SITE_ORIGIN}/og.png" />
${options.jsonLd.map((item) => `<script type="application/ld+json">${JSON.stringify(item).replaceAll("<", "\\u003c")}</script>`).join("\n")}
<style>
:root{--bg:#f4eee6;--ink:#2f2725;--muted:#6f625d;--line:#d9cfc4;--panel:#fffaf4;--accent:#b4532a;--up:#2f7d4f;--down:#b23b3b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}header,main,footer{max-width:880px;margin:0 auto;padding:0 20px}
header{display:flex;justify-content:space-between;align-items:center;padding-top:18px;padding-bottom:18px}
.brand{font-weight:700;text-decoration:none;color:var(--ink)}.brand span{color:var(--accent)}
h1{font-size:clamp(26px,4vw,36px);line-height:1.2;margin:8px 0 6px}h2{font-size:21px;margin:34px 0 10px}
.meta{color:var(--muted);font-size:14px}.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:16px 0}
table{width:100%;border-collapse:collapse;font-size:15px}td,th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--muted);font-weight:500;width:38%}
.cta{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;padding:12px 18px;border-radius:10px;margin:6px 8px 6px 0}
.cta.secondary{background:transparent;color:var(--accent);border:1px solid var(--accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}.grid a{display:block;padding:8px 10px;background:var(--panel);border:1px solid var(--line);border-radius:8px;text-decoration:none;color:var(--ink);font-size:14px}
.grid a b{color:var(--accent)}.note{font-size:13px;color:var(--muted)}.up{color:var(--up)}.down{color:var(--down)}
footer{padding-top:30px;padding-bottom:40px;font-size:13px;color:var(--muted)}
</style>
</head>
<body>
<header><a class="brand" href="/"><span>W</span> EasyWyckoff</a><nav><a href="/wyckoff">Stocks</a> · <a href="/learn/en">Learn Wyckoff</a> · <a href="/app">Workbench</a></nav></header>
<main>
${options.body}
</main>
<footer>EasyWyckoff is a research and education tool. Nothing on this page is investment advice; levels are conditional scenarios computed from price and volume, not predictions.</footer>
</body>
</html>`;
}

function relatedLinks(current: SeoTicker | undefined): string {
  const peers = SEO_TICKERS.filter((ticker) => ticker.symbol !== current?.symbol && ticker.group === (current?.group ?? "US stocks")).slice(0, 12);
  return `<div class="grid">${peers
    .map((ticker) => `<a href="/wyckoff/${slugFor(ticker.symbol)}"><b>${escapeHtml(ticker.symbol.replace(/\.US$/, ""))}</b> ${escapeHtml(ticker.name)}</a>`)
    .join("")}</div>`;
}

export function renderStockPage(research: ResearchResponse, perf: Performance, ticker: SeoTicker | undefined): string {
  const s = research.strategy;
  const code = research.symbol.replace(/\.US$/, "");
  const name = ticker?.name ?? research.fundamentals.companyName ?? research.name ?? code;
  const cur = research.currency;
  const price = research.quote.price;
  const asOf = isoDate(research.quote.asOf);
  const slug = slugFor(research.symbol);
  const canonical = `${SITE_ORIGIN}/wyckoff/${slug}`;
  const appLink = `/app?symbol=${encodeURIComponent(research.symbol)}&analyze=1`;

  const maParts = [
    s.trend.ma20 !== null ? `${price >= s.trend.ma20 ? "above" : "below"} the 20-day average (${money(s.trend.ma20, cur)})` : null,
    s.trend.ma50 !== null ? `${price >= s.trend.ma50 ? "above" : "below"} the 50-day (${money(s.trend.ma50, cur)})` : null,
    s.trend.ma200 !== null ? `${price >= s.trend.ma200 ? "above" : "below"} the 200-day (${money(s.trend.ma200, cur)})` : null,
  ].filter(Boolean);

  const rangeText = s.range
    ? `The engine finds a trading range between <b>${money(s.range.support, cur)}</b> and <b>${money(s.range.resistance, cur)}</b> (${isoDate(s.range.startTime)} → ${isoDate(s.range.endTime)}): ${escapeHtml(HYPOTHESIS_LABEL[s.range.hypothesis] ?? HYPOTHESIS_LABEL.unclear)}. In Wyckoff terms, a range is where large operators build (accumulation) or unload (distribution) a position; the edges are the levels to watch.`
    : `There is no recent trading range close to the current price — ${escapeHtml(code)} is trending rather than building a base. Wyckoff analysis then focuses on the nearest swing levels and on whether pullbacks come on light volume (healthy) or heavy volume (supply).`;

  const volumeText =
    perf.volumeRatio === null
      ? ""
      : perf.volumeRatio >= 1.3
        ? ` Volume over the last 10 sessions is ${perf.volumeRatio.toFixed(1)}× the prior average — effort is rising, so watch whether the result (price progress) matches it.`
        : perf.volumeRatio <= 0.75
          ? ` Volume over the last 10 sessions is only ${perf.volumeRatio.toFixed(1)}× the prior average — activity is drying up, which often precedes the next directional move.`
          : ` Volume over the last 10 sessions is close to its prior average (${perf.volumeRatio.toFixed(1)}×).`;

  const title = `${code} Wyckoff Analysis: Trading Range, Support & Resistance (${asOf})`;
  const description = `${name} (${code}) Wyckoff structure as of ${asOf}: ${BIAS_LABEL[s.bias].toLowerCase()}, close ${money(price, cur)}, support ${money(s.support[0]?.price, cur)}, resistance ${money(s.resistance[0]?.price, cur)}. Trigger, invalidation and key levels from price and volume.`;

  const levelsRows = (levels: ResearchStrategy["support"]) =>
    levels.length
      ? levels.map((level) => `${money(level.price, cur)} <span class="note">(${level.kind === "range" ? "range edge" : level.kind === "ma" ? "moving average" : "swing"})</span>`).join("<br/>")
      : "—";

  const body = `
<p class="meta"><a href="/wyckoff">Wyckoff stock analysis</a> › ${escapeHtml(code)}</p>
<h1>${escapeHtml(code)} Wyckoff analysis</h1>
<p class="meta">${escapeHtml(name)} · Daily chart · Data as of ${asOf} · Close ${money(price, cur)} <span class="${(research.quote.changePct ?? 0) >= 0 ? "up" : "down"}">${pct(research.quote.changePct)}</span></p>

<div class="card">
<p><b>Structure bias: ${escapeHtml(BIAS_LABEL[s.bias])}.</b> Short-term trend is ${TREND_WORD[s.trend.short]}, medium-term ${TREND_WORD[s.trend.medium]}, long-term ${TREND_WORD[s.trend.long]}. ${maParts.length ? `Price is ${maParts.join(", ")}.` : ""}</p>
<p>What would confirm it: ${triggerSentence(s, cur, price)}. What would invalidate it: a daily close ${s.invalidation.kind === "closeAbove" ? "above" : "below"} <b>${money(s.invalidation.price, cur)}</b>.</p>
<a class="cta" href="${appLink}">Run the full AI Wyckoff analysis on ${escapeHtml(code)} — free</a>
<p class="note">The AI agent reads the same chart, labels Wyckoff events (SC, AR, ST, Spring, SOS, UT, SOW) on the candles with evidence for each, and writes a conditional plan. One free analysis, no card needed.</p>
</div>

<h2>Trading range and phase</h2>
<p>${rangeText}${volumeText}</p>

<h2>Key levels</h2>
<table>
<tr><th>Support</th><td>${levelsRows(s.support)}</td></tr>
<tr><th>Resistance</th><td>${levelsRows(s.resistance)}</td></tr>
<tr><th>52-week range</th><td>${money(perf.low52, cur)} – ${money(perf.high52, cur)}</td></tr>
<tr><th>Performance</th><td>20 days ${pct(perf.change20)} · 60 days ${pct(perf.change60)}</td></tr>
<tr><th>Average true range</th><td>${money(s.atr, cur)} per day</td></tr>
</table>

<h2>Conditional scenario</h2>
<table>
<tr><th>Trigger</th><td>${triggerSentence(s, cur, price)}</td></tr>
<tr><th>Reference entry zone</th><td>${money(s.entryLow, cur)} – ${money(s.entryHigh, cur)}</td></tr>
<tr><th>Invalidation</th><td>Daily close ${s.invalidation.kind === "closeAbove" ? "above" : "below"} ${money(s.invalidation.price, cur)}</td></tr>
<tr><th>Targets</th><td>${money(s.target1, cur)} · ${money(s.target2, cur)}${s.riskReward ? ` <span class="note">(≈${s.riskReward}R to the first target)</span>` : ""}</td></tr>
</table>
<p class="note">Computed mechanically from swing points, trading ranges and volatility (ATR) — the same deterministic engine the workbench uses before the AI reads the chart. It updates with each daily bar.</p>

<h2>How to read this with the Wyckoff method</h2>
<p>Wyckoff analysis asks three questions: where is the trading range, who is in control inside it (accumulation or distribution), and which test confirms the next move. Supply and demand show up as the relationship between <i>effort</i> (volume) and <i>result</i> (price spread and close). A breakout on expanding volume that holds on a quiet pullback is strength; a rally on heavy volume that closes weak near resistance is supply. <a href="/learn/en">Read the full Wyckoff guide →</a></p>
<a class="cta" href="${appLink}">Open ${escapeHtml(code)} in the workbench</a>
<a class="cta secondary" href="/wyckoff">More stocks</a>

<h2>Related Wyckoff analyses</h2>
${relatedLinks(ticker)}
`;

  return layout({
    title,
    description,
    canonical,
    body,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Wyckoff stock analysis", item: `${SITE_ORIGIN}/wyckoff` },
          { "@type": "ListItem", position: 2, name: `${code} Wyckoff analysis`, item: canonical },
        ],
      },
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: title,
        description,
        dateModified: research.generatedAt,
        about: { "@type": "Corporation", name, tickerSymbol: code },
        publisher: { "@type": "Organization", name: "EasyWyckoff", url: SITE_ORIGIN },
        mainEntityOfPage: canonical,
      },
    ],
  });
}

export function renderIndexPage(): string {
  const groups = ["US stocks", "US ETFs", "China A-shares"] as const;
  const body = `
<h1>Wyckoff analysis for popular stocks and ETFs</h1>
<p class="meta">Trading ranges, support and resistance, trend and a conditional trigger for each symbol — computed daily from price and volume.</p>
<div class="card"><p>Pick a symbol to see its current Wyckoff structure, or open the workbench to have the AI agent label accumulation and distribution events on any US or China A-share chart.</p>
<a class="cta" href="/app?start=1">Analyze any symbol — free</a> <a class="cta secondary" href="/learn/en">Learn the Wyckoff method</a></div>
${groups
  .map(
    (group) => `<h2>${group}</h2><div class="grid">${SEO_TICKERS.filter((ticker) => ticker.group === group)
      .map((ticker) => `<a href="/wyckoff/${slugFor(ticker.symbol)}"><b>${escapeHtml(ticker.symbol.replace(/\.US$/, ""))}</b> ${escapeHtml(ticker.name)}</a>`)
      .join("")}</div>`,
  )
  .join("\n")}
`;
  return layout({
    title: "Wyckoff Stock Analysis: Accumulation, Distribution & Key Levels | EasyWyckoff",
    description:
      "Daily Wyckoff structure for NVDA, AAPL, TSLA, SPY, QQQ and more: trading ranges, support and resistance, trend and the trigger that would confirm the next move.",
    canonical: `${SITE_ORIGIN}/wyckoff`,
    body,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Wyckoff stock analysis",
        url: `${SITE_ORIGIN}/wyckoff`,
        hasPart: SEO_TICKERS.map((ticker) => ({ "@type": "WebPage", url: `${SITE_ORIGIN}/wyckoff/${slugFor(ticker.symbol)}` })),
      },
    ],
  });
}

function html(content: string, status: number, cache: string): Response {
  return new Response(content, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": cache },
  });
}

function notFound(): Response {
  return html(
    layout({
      title: "Symbol not found | EasyWyckoff",
      description: "This symbol is not available.",
      canonical: `${SITE_ORIGIN}/wyckoff`,
      noindex: true,
      body: `<h1>Symbol not found</h1><p>We could not find market data for this symbol. <a href="/wyckoff">Browse available stocks</a> or <a href="/app?start=1">search in the workbench</a>.</p>`,
      jsonLd: [],
    }),
    404,
    "public, max-age=300, s-maxage=3600",
  );
}

/** Handles /wyckoff and /wyckoff/:slug. Returns null for any other path. */
export async function handleStockPage(request: Request): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  if (path !== "/wyckoff" && !path.startsWith("/wyckoff/")) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405 });
  if (path === "/wyckoff") return html(renderIndexPage(), 200, CACHE_OK);

  const slug = decodeURIComponent(path.slice("/wyckoff/".length));
  const symbol = symbolFromSlug(slug);
  if (!symbol) return notFound();
  const canonicalSlug = slugFor(symbol);
  if (canonicalSlug !== slug) {
    return new Response(null, { status: 301, headers: { Location: `/wyckoff/${canonicalSlug}`, "Cache-Control": CACHE_OK } });
  }

  try {
    const [research, perf] = await Promise.all([
      getResearch({ symbol, period: "1d", adjust: "forward" }),
      performance(symbol),
    ]);
    const ticker = findTicker(symbol);
    // Only curated symbols are indexable; any other valid symbol still renders
    // for visitors but asks search engines not to index thin variants.
    const page = renderStockPage(research, perf, ticker);
    return html(ticker ? page : page.replace('content="index,follow,max-image-preview:large"', 'content="noindex,follow"'), 200, CACHE_OK);
  } catch (error) {
    if (error instanceof MarketDataError && (error.status === 404 || error.code === "NOT_FOUND" || error.code === "NO_DATA")) {
      return notFound();
    }
    console.error("[seo] stock page failed:", error instanceof Error ? error.message : error);
    return new Response("Temporarily unavailable", {
      status: 503,
      headers: { "Retry-After": "300", "Cache-Control": "no-store" },
    });
  }
}

/** Sitemap entries for the stock pages, for the build-time sitemap and tests. */
export function stockPageUrls(): string[] {
  return [`${SITE_ORIGIN}/wyckoff`, ...SEO_TICKERS.map((ticker) => `${SITE_ORIGIN}/wyckoff/${slugFor(ticker.symbol)}`)];
}
