import type { Lang } from "../i18n.js";

export interface LandingCopy {
  brand: string;
  language: string;
  bug: string;
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
  sample: {
    kicker: string;
    title: string;
    intro: string;
    window: string;
    thesis: string;
    phase: string;
    range: string;
    bias: string;
    trigger: string;
    entry: string;
    stop: string;
    targets: string;
    invalidation: string;
    levels: string;
    cta: string;
    note: string;
  };
  features: {
    kicker: string;
    title: string;
    items: string[];
  };
  pricing: {
    kicker: string;
    title: string;
    intro: string;
    free: string;
    daily: string;
    packs: string;
    billing: string;
    cta: string;
  };
  faq: {
    kicker: string;
    title: string;
    items: Array<{ q: string; a: string }>;
  };
  footer: string;
}

const zh: LandingCopy = {
  brand: "EasyWyckoff",
  language: "English",
  bug: "反馈问题",
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
  sample: {
    kicker: "SAMPLE ANALYSIS · NVDA.US",
    title: "先看一份真实分析，再决定要不要注册。",
    intro: "这不是截图或营销文案，而是工作台里同一套结构分析。你会看到阶段、区间、关键事件、交易计划和什么情况下判断失效。",
    window: "2025-11-11 → 2026-11-10 · 1D · 前复权",
    thesis: "UT 失败后价格跌回区间，SOW 确认供给仍占优；当前是派发后的 Markdown，而不是新的吸筹。",
    phase: "阶段 E · Markdown（派发后下跌）",
    range: "派发区间 208.93 – 230.21",
    bias: "偏空，等待反抽失败",
    trigger: "反抽无法站回 169.91",
    entry: "166.96 – 171.88 反抽区",
    stop: "177.79（区间上沿上方）",
    targets: "T1 157.74 · T2 150.21",
    invalidation: "日线收盘站上 177.79，空头结构失效",
    levels: "支撑 169.91 / 152.73 / 148.80 · 阻力 177.79 / 187.56",
    cta: "打开工作台，用同一套方法分析任意标的",
    note: "示例为历史结构复盘，用于说明输出格式，不构成实时建议。",
  },
  features: {
    kicker: "WHAT YOU GET",
    title: "不是一句“AI 看涨”，而是可核对的证据链。",
    items: [
      "真实 K 线 + 成交量，支持美股与 A 股，日线以上周期免费",
      "Wyckoff 区间、阶段、Spring / UT / SOS / SOW 等事件识别",
      "每条标注带证据、反证和置信度，可以在图上逐条核对",
      "Agent 计算触发价、入场区、止损、目标和失效条件",
      "价格提醒邮件、自选分组、分析记忆与可恢复会话",
    ],
  },
  pricing: {
    kicker: "SIMPLE PRICING",
    title: "先免费用，觉得有用再买 credits。",
    intro: "图表和研究面板可以直接浏览；AI 分析按实际模型 token 计费，不用订阅。",
    free: "免费试用：不用注册即可完整分析 1 次",
    daily: "每天登录再送 2 credits",
    packs: "Starter $2 / 30 credits · Pro $4 / 80 credits",
    billing: "1 credit ≈ 20,000 tokens，最低 1 credit；失败的请求自动返还。",
    cta: "创建账户，开始分析",
  },
  faq: {
    kicker: "FAQ",
    title: "注册前你可能想知道",
    items: [
      { q: "这是投资建议吗？", a: "不是。它是价格、成交量和市场结构的研究工具；交易计划是条件情景，不是收益承诺。" },
      { q: "不登录能看什么？", a: "可以看首页示例、学习页、个股结构页、实时 K 线和成交量，并免费完整试用 1 次 AI 分析；之后需要账户来保存会话和扣减 credits。" },
      { q: "credits 怎么扣？", a: "按模型实际 token 计费，约 20,000 tokens = 1 credit，最低 1 credit；分析失败或中断会返还。" },
      { q: "支持哪些市场？", a: "目前重点覆盖美股和 A 股；港股不在产品范围内。" },
      { q: "AI 会预测涨跌吗？", a: "不会给确定性预测。它会给出基准/备选情景、触发条件和失效条件，方便你验证而不是盲信。" },
    ],
  },
  footer: "EasyWyckoff · 研究与教育用途，不构成投资建议。",
};

const en: LandingCopy = {
  brand: "EasyWyckoff",
  language: "中文",
  bug: "Report a bug",
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
  sample: {
    kicker: "SAMPLE ANALYSIS · NVDA.US",
    title: "See a real analysis before you create an account.",
    intro: "This is the same structure output the workbench produces, not a marketing mockup: phase, range, key events, a conditional plan and what would invalidate it.",
    window: "2025-11-11 → 2026-11-10 · 1D · Forward adjusted",
    thesis: "After a failed UT and a SOW, supply still controls the tape. This is post-distribution markdown, not a fresh accumulation base.",
    phase: "Phase E · Markdown after distribution",
    range: "Distribution range 208.93 – 230.21",
    bias: "Short — wait for a failed retest",
    trigger: "Retest fails to reclaim 169.91",
    entry: "166.96 – 171.88 retest zone",
    stop: "177.79 (above the range top)",
    targets: "T1 157.74 · T2 150.21",
    invalidation: "A daily close above 177.79 invalidates the short structure",
    levels: "Support 169.91 / 152.73 / 148.80 · Resistance 177.79 / 187.56",
    cta: "Open the workbench and analyze any symbol",
    note: "Historical structure review for illustration only; not a live recommendation.",
  },
  features: {
    kicker: "WHAT YOU GET",
    title: "Not “AI says up” — an evidence trail you can check.",
    items: [
      "Real candles and volume for US and A-share markets; daily+ timeframes are free",
      "Wyckoff ranges, phases and events such as Spring, UT, SOS and SOW",
      "Every annotation includes evidence, counter-evidence and confidence",
      "The Agent computes triggers, entry zones, stops, targets and invalidation",
      "Price alerts, watchlist groups, research memory and resumable sessions",
    ],
  },
  pricing: {
    kicker: "SIMPLE PRICING",
    title: "Use it free first. Buy credits only when it earns its place.",
    intro: "Charts and the research panel are open to browse; AI analysis is billed by actual model tokens, with no subscription required.",
    free: "Free trial: one full analysis, no account needed",
    daily: "2 more credits for each daily login",
    packs: "Starter $2 / 30 credits · Pro $4 / 80 credits",
    billing: "1 credit ≈ 20,000 tokens, minimum 1 credit; failed requests are refunded.",
    cta: "Create an account and start analyzing",
  },
  faq: {
    kicker: "FAQ",
    title: "What to know before signing up",
    items: [
      { q: "Is this investment advice?", a: "No. It is a research tool for price, volume and market structure. Trade plans are conditional scenarios, not return promises." },
      { q: "What can I see without signing in?", a: "The homepage sample, learn pages, stock structure pages, live candles and volume — plus one full AI analysis as a free trial. After that, an account saves your sessions and meters credits." },
      { q: "How are credits charged?", a: "By actual model tokens: about 20,000 tokens per credit, minimum 1. Failed or interrupted analyses are refunded." },
      { q: "Which markets are covered?", a: "The product focuses on US and A-share markets; Hong Kong stocks are intentionally excluded." },
      { q: "Does the AI predict price?", a: "It does not make deterministic predictions. It gives base and alternative scenarios, triggers and invalidation conditions so you can verify the thesis." },
    ],
  },
  footer: "EasyWyckoff · Research and education only; not investment advice.",
};

export const landingCopy: Record<Lang, LandingCopy> = { zh, en };
