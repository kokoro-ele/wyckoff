import type { Lang } from "../i18n.js";

export type TermCode = "Spring" | "Shakeout" | "SOS" | "LPS" | "UT" | "SOW";

export interface TermCopy {
  code: TermCode;
  name: string;
  body: string;
}

export interface LandingCopy {
  brand: string;
  language: string;
  hero: {
    kicker: string;
    title: string;
    cta: string;
    learn: string;
    symbol: string;
    window: string;
    zoneLabel: string;
  };
  chart: {
    range: string;
    phase: string;
    loading: string;
    unavailable: string;
  };
  glossary: {
    kicker: string;
    title: string;
    more: string;
    terms: TermCopy[];
  };
  footer: string;
}

const zh: LandingCopy = {
  brand: "EasyWyckoff",
  language: "English",
  hero: {
    kicker: "WYCKOFF · PRICE & VOLUME",
    title: "看见价格背后的结构",
    cta: "现在开始",
    learn: "学习 Wyckoff",
    symbol: "NVDA.US",
    window: "2025-11-11 → 2026-11-10",
    zoneLabel: "派发区间",
  },
  chart: {
    range: "交易区间",
    phase: "阶段",
    loading: "正在读取图表…",
    unavailable: "图表暂时不可用",
  },
  glossary: {
    kicker: "THE LANGUAGE",
    title: "六个名词，读懂图上的语言",
    more: "全部名词与图例 →",
    terms: [
      { code: "Spring", name: "弹簧", body: "跌破区间下沿后快速收回，测试供给。" },
      { code: "Shakeout", name: "震仓", body: "宽价差放量下破，收盘拉回区间内。" },
      { code: "SOS", name: "强势信号", body: "放量宽价差越过区间上沿。" },
      { code: "LPS", name: "最后支撑", body: "突破后回踩更高低点，缩量止跌。" },
      { code: "UT", name: "上冲回落", body: "假突破区间上沿，收盘跌回区间内。" },
      { code: "SOW", name: "弱势信号", body: "放量跌破区间下沿，结构转弱。" },
    ],
  },
  footer: "EasyWyckoff · 研究与教育用途，不构成投资建议。",
};

const en: LandingCopy = {
  brand: "EasyWyckoff",
  language: "中文",
  hero: {
    kicker: "WYCKOFF · PRICE & VOLUME",
    title: "See the structure behind the price.",
    cta: "Start now",
    learn: "Learn Wyckoff",
    symbol: "NVDA.US",
    window: "2025-11-11 → 2026-11-10",
    zoneLabel: "Distribution",
  },
  chart: {
    range: "Trading range",
    phase: "Phase",
    loading: "Reading the chart…",
    unavailable: "Chart is temporarily unavailable",
  },
  glossary: {
    kicker: "THE LANGUAGE",
    title: "Six terms, one visual language",
    more: "All terms & diagrams →",
    terms: [
      { code: "Spring", name: "Spring", body: "Sweeps below support, then closes back inside." },
      { code: "Shakeout", name: "Shakeout", body: "Wide spread and volume below support, then a recovery." },
      { code: "SOS", name: "Sign of Strength", body: "Wide-spread, high-volume break above resistance." },
      { code: "LPS", name: "Last support", body: "Higher low after the break, on lighter volume." },
      { code: "UT", name: "Upthrust", body: "Sweeps above resistance, then closes back inside." },
      { code: "SOW", name: "Sign of Weakness", body: "High-volume break below support." },
    ],
  },
  footer: "EasyWyckoff · Research and education only; not investment advice.",
};

export const landingCopy: Record<Lang, LandingCopy> = { zh, en };
