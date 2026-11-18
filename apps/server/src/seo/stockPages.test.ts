import { describe, expect, it } from "vitest";
import type { ResearchResponse } from "@wyckoff/shared";
import { SEO_TICKERS, slugFor, symbolFromSlug } from "./tickers.js";
import { renderIndexPage, renderStockPage, stockPageUrls } from "./stockPages.js";

describe("stock page slugs", () => {
  it("round-trips every curated symbol", () => {
    for (const ticker of SEO_TICKERS) {
      expect(symbolFromSlug(slugFor(ticker.symbol))).toBe(ticker.symbol);
    }
  });

  it("maps bare and dotted US tickers and rejects junk", () => {
    expect(symbolFromSlug("nvda")).toBe("NVDA.US");
    expect(symbolFromSlug("brk-b")).toBe("BRK.B.US");
    expect(symbolFromSlug("600519-sh")).toBe("600519.SH");
    expect(symbolFromSlug("../etc")).toBeNull();
    expect(symbolFromSlug("<script>")).toBeNull();
  });

  it("lists the index plus one URL per curated symbol", () => {
    expect(stockPageUrls()).toHaveLength(SEO_TICKERS.length + 1);
  });
});

const research: ResearchResponse = {
  symbol: "NVDA.US",
  name: "英伟达",
  exchange: "US",
  region: "US",
  currency: "USD",
  quote: { price: 155.46, prevClose: 156.14, changePct: -0.44, high: 158, low: 150, volume: 1, asOf: Date.UTC(2026, 10, 17), source: "tickflow" },
  fundamentals: {
    source: "test",
    currency: "USD",
    companyName: "NVIDIA CORP",
    marketCap: null,
    pe: null,
    pb: null,
    eps: null,
    dividendYieldPct: null,
    week52High: null,
    week52Low: null,
    revenue: null,
    netIncome: null,
    grossMarginPct: null,
    netMarginPct: null,
    roePct: null,
    fiscalYear: null,
    updatedAt: null,
  },
  strategy: {
    bias: "short",
    trigger: { kind: "breakdown", price: 169.91 },
    entryLow: 167,
    entryHigh: 171.85,
    stop: 177.68,
    target1: 148.8,
    target2: 133.3,
    riskReward: 2.1,
    invalidation: { kind: "closeAbove", price: 177.68 },
    support: [{ price: 148.8, kind: "swing" }],
    resistance: [{ price: 163.67, kind: "swing" }],
    trend: { short: "down", medium: "down", long: "flat", ma20: 192.59, ma50: 211.75, ma200: 203.6 },
    atr: 9.71,
    range: null,
  },
  generatedAt: "2026-11-18T00:00:00.000Z",
};

describe("stock page rendering", () => {
  const perf = { change20: -12.3, change60: -25.1, volumeRatio: 1.4, high52: 243.37, low52: 148.8 };

  it("renders an indexable page with canonical URL, key levels and a deep link", () => {
    const page = renderStockPage(research, perf, SEO_TICKERS[0]);
    expect(page).toContain('<link rel="canonical" href="https://easywyckoff.online/wyckoff/nvda" />');
    expect(page).toContain("NVDA Wyckoff Analysis");
    expect(page).toContain("$148.80");
    expect(page).toContain("/app?symbol=NVDA.US&analyze=1");
    expect(page).toContain('content="index,follow');
  });

  it("escapes names that come from data", () => {
    const page = renderStockPage(
      { ...research, name: "<img src=x onerror=alert(1)>", fundamentals: { ...research.fundamentals, companyName: null } },
      perf,
      undefined,
    );
    expect(page).not.toContain("<img src=x");
  });

  it("renders the index with links to every symbol", () => {
    const page = renderIndexPage();
    for (const ticker of SEO_TICKERS) expect(page).toContain(`/wyckoff/${slugFor(ticker.symbol)}"`);
  });
});
