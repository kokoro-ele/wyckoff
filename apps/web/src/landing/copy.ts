import type { Lang } from "../i18n.js";

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
  method: {
    kicker: string;
    title: string;
    body: string;
    link: string;
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
  method: {
    kicker: "THE WYCKOFF METHOD",
    title: "先看复合人，再读事件与阶段",
    body: "Wyckoff 把市场想象成一个 Composite Man：他用区间、量能和收盘位置制造假象。先识别吸筹或派发区间，再用 Spring、SOS、UT、SOW 等事件和 A–E 阶段确认结构。",
    link: "打开 Wyckoff Analytics 方法介绍",
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
  method: {
    kicker: "THE WYCKOFF METHOD",
    title: "Read the Composite Man, events and phases",
    body: "Wyckoff treats the market as a Composite Man: ranges, volume and closes are used to create false impressions. First identify accumulation or distribution, then confirm the structure with events such as Spring, SOS, UT and SOW, and phases A–E.",
    link: "Open the Wyckoff Analytics method guide",
  },
  footer: "EasyWyckoff · Research and education only; not investment advice.",
};

export const landingCopy: Record<Lang, LandingCopy> = { zh, en };
