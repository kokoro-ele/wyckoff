import type { Lang } from "../i18n.js";

const zhCopy = {
  nav: {
    method: "Wyckoff 方法",
    cases: "真实案例",
    workbench: "工作台",
    credits: "次数",
    open: "打开工作台",
    language: "English",
  },
  hero: {
    kicker: "WYCKOFF METHOD · AI RESEARCH WORKBENCH",
    title: "看见价格背后的结构",
    subtitle:
      "先读区间、量能与努力/结果，再把结构变成可检查的计划。行情免费看，分析时再登录。",
    primary: "免费开始看图",
    secondary: "先读 Wyckoff 方法",
    noteFree: "首次注册送 3 次分析",
    noteBrowse: "不登录也能先看行情",
    tape: "事实 → 结构 → 计划",
    shotAlt: "EasyWyckoff 工作台：顶部操作栏、K 线图、自选和只读研究面板",
    shotCaption: "顶部操作栏 · 三栏工作台 · 只读研究面板",
  },
  strip: ["免登录先看图", "基本面 + 交易策略", "Agent 图上标注", "中文 / English"],
  method: {
    kicker: "THE METHOD",
    title: "Wyckoff 是价格和成交量讲的故事",
    intro:
      "先算事实，再让 Agent 解释结构；规则负责执行。",
    lawsTitle: "三条法则",
    laws: [
      { title: "供需", body: "价格移动，是因为一方更急；量能是证据。" },
      { title: "因果", body: "区间积累“因”，突破和趋势是“果”。" },
      { title: "努力与结果", body: "量能是努力，价差和收盘是结果。" },
    ],
    cycleTitle: "市场周期",
    cycle: [
      { name: "吸筹", phase: "Phase A–C", body: "下跌后的横盘，Spring/Shakeout 清洗浮筹。" },
      { name: "上涨", phase: "Phase D–E", body: "SOS 跳过小溪，LPS 回踩确认。" },
      { name: "派发", phase: "Phase A–C", body: "上涨后的横盘，UT/UTAD 制造假突破。" },
      { name: "下跌", phase: "Phase D–E", body: "SOW 跌破冰面，LPSY 反弹失败。" },
    ],
    eventsTitle: "图上的语言",
    eventsIntro: "事件代号是 Wyckoff 的通用词汇；中文和英文只改变描述，不改变结构。",
    events: [
      { code: "SC", name: "卖出高潮", body: "宽价差、极端量能，收盘拉离最低点。" },
      { code: "AR", name: "自动反弹", body: "第一次反弹，定义交易区间的上沿。" },
      { code: "ST", name: "二次测试", body: "再次回到低点，量能通常缩小。" },
      { code: "Spring", name: "弹簧 / 震仓", body: "下破支撑后收回，清洗止损并测试供给。" },
      { code: "SOS", name: "强势信号", body: "宽价差、放量越过阻力，结构转强。" },
      { code: "LPS", name: "最后支撑", body: "突破后的更高低点，回踩不破。" },
      { code: "UT / UTAD", name: "上冲回落", body: "上破阻力后失败，需求被消耗。" },
      { code: "SOW / LPSY", name: "弱势信号", body: "跌破支撑或反弹失败，派发进入 markdown。" },
    ],
    layersTitle: "工作台怎么分工",
    layers: [
      { title: "事实", body: "OHLCV、摆动点、交易区间、量比与价差比全部由确定性代码计算。" },
      { title: "解释", body: "Agent 只负责命名阶段和事件，并把它们画回对应 K 线。" },
      { title: "执行", body: "入场、止损、目标和风险收益比由规则计算，可复盘、可检查。" },
    ],
    cta: "用一张真实图表试试",
  },
  cases: {
    kicker: "REAL CASES",
    title: "两段真实的量价结构",
    intro: "K 线与标注来自固定历史窗口；事件是工作台读法，不构成买卖建议。",
    dataNote: "数据：TickFlow 日线 · 案例窗口固定 · 仅用于方法演示",
    disclaimer: "历史结构不能预测未来；所有点位仅为研究记录。",
    aapl: {
      title: "苹果 · 再吸筹后的 SOS 与 UT",
      tag: "再吸筹 → SOS / UT",
      window: "2026-06-15 → 2026-11-10",
      zoneLabel: "再吸筹区间",
      narrative:
        "7/31 下探 299.74 后收在当根上沿，2.6× 量；299.74–322.37 成为再吸筹区间。11/03 回踩 325.33（LPS）；11/04 以 2.1× 量、+5.31% 收 349.51（SOS）；11/05 冲高 355.38 后收在底部 16%，留下 UT 风险。",
      bullets: [
        "7/31 震仓 299.74 / 2.6× 量",
        "11/04 SOS 349.51 / +5.31%",
        "11/05 UT 355.38 / 收在底部 16%",
      ],
      levels: "支撑 338.30 / 325.33 · 阻力 351.73 / 355.38",
    },
    maotai: {
      title: "贵州茅台 · 低位吸筹后的放量突破",
      tag: "吸筹 → SOS / UT",
      window: "2026-05-01 → 2026-11-10",
      zoneLabel: "吸筹区间",
      narrative:
        "6/15–7/13 在 1170.28–1234.78 横盘，6/28 下探 1151.01 后收回。11/02 收 1480.00（SOS）、11/03 高点 1480.60 后收 1446.44（UT）；11/10 收 1402.30。",
      bullets: [
        "6/15–7/13 区间 1170.28–1234.78",
        "6/28 低点 1151.01 / 收 1194.96",
        "11/03 高点 1480.60；11/10 收 1402.30",
      ],
      levels: "支撑 1359.97 · 阻力 1480.60",
    },
  },
  workbench: {
    kicker: "THE WORKBENCH",
    title: "一张书桌，不是黑箱",
    body:
      "顶部是五个入口，左边自选，中间 K 线，右边是只读研究与 Agent 标签。",
    features: [
      { title: "只读研究", body: "基本面、估值与规则策略，只读，不扣次数。" },
      { title: "Agent", body: "读图、标注结构，并解释量价证据。" },
      { title: "账户", body: "3 次免费、永久次数包、邀请奖励。" },
      { title: "双语与主题", body: "中文 / English，标注跟随语言。" },
    ],
    cta: "进入工作台",
    imageAlt: "EasyWyckoff 研究工作台界面",
  },
  credits: {
    kicker: "START SMALL",
    title: "先用 3 次，把结构看清楚",
    body:
      "验证邮箱后获得 3 次永久分析；每次分析或追问扣 1 次，失败自动返还。邀请一位完成验证的新用户，双方各得 3 次。",
    free: "3 次免费",
    invite: "邀请再送 3 次",
    packs: "永久次数包",
    cta: "打开工作台",
    note: "次数包价格与内容由运营方在服务端配置；本页不承诺具体价格。",
  },
  footer: {
    tagline: "EasyWyckoff · 看见价格背后的结构",
    method: "Wyckoff 方法",
    cases: "真实案例",
    workbench: "工作台",
    docs: "方法说明",
    disclaimer: "研究与教育工具，不构成投资建议。行情可能延迟。",
    copyright: "© 2026 EasyWyckoff",
  },
  chart: {
    range: "区间",
    phase: "阶段",
    support: "支撑",
    resistance: "阻力",
    loading: "正在读图…",
    unavailable: "案例数据暂时不可用",
    data: "TickFlow 日线",
    open: "在图中打开",
  },
};

export type LandingCopy = typeof zhCopy;

const enCopy: LandingCopy = {
  nav: {
    method: "Wyckoff method",
    cases: "Real cases",
    workbench: "Workbench",
    credits: "Credits",
    open: "Open workbench",
    language: "中文",
  },
  hero: {
    kicker: "WYCKOFF METHOD · AI RESEARCH WORKBENCH",
    title: "See the structure behind the price.",
    subtitle:
      "Read ranges, volume and effort vs result, then turn the structure into a checkable plan. Browse free; sign in to analyze.",
    primary: "Start with a chart",
    secondary: "Read the method",
    noteFree: "3 free analyses on first signup",
    noteBrowse: "Browse without signing in",
    tape: "Facts → Structure → Plan",
    shotAlt: "EasyWyckoff workbench with top bar, candlestick chart, watchlist and read-only research panel",
    shotCaption: "Top bar · three-column desk · read-only research",
  },
  strip: ["Browse without login", "Fundamentals + trade strategy", "Agent annotations", "English / 中文"],
  method: {
    kicker: "THE METHOD",
    title: "Wyckoff is a story told by price and volume.",
    intro:
      "Facts first, Agent interpretation second, rules for execution.",
    lawsTitle: "Three laws",
    laws: [
      { title: "Supply & demand", body: "Price moves when one side is more urgent." },
      { title: "Cause & effect", body: "A range builds the cause; the breakout is the effect." },
      { title: "Effort vs result", body: "Volume is effort; spread and close are result." },
    ],
    cycleTitle: "The market cycle",
    cycle: [
      { name: "Accumulation", phase: "Phase A–C", body: "A range after a decline; Spring/Shakeout flushes weak hands." },
      { name: "Markup", phase: "Phase D–E", body: "SOS jumps the Creek; LPS holds the higher low." },
      { name: "Distribution", phase: "Phase A–C", body: "A range after a rally; UT/UTAD traps late buyers." },
      { name: "Markdown", phase: "Phase D–E", body: "SOW breaks the Ice; LPSY fails to reclaim." },
    ],
    eventsTitle: "The language on the chart",
    eventsIntro: "Event codes are Wyckoff's common vocabulary. Chinese and English change the description, not the structure.",
    events: [
      { code: "SC", name: "Selling climax", body: "Wide spread, climactic volume, close off the low." },
      { code: "AR", name: "Automatic rally", body: "The first rebound that defines the top of the range." },
      { code: "ST", name: "Secondary test", body: "A revisit to the low, usually on lower volume." },
      { code: "Spring", name: "Spring / Shakeout", body: "A sweep below support that is reclaimed, testing supply." },
      { code: "SOS", name: "Sign of strength", body: "Wide spread and expanding volume through resistance." },
      { code: "LPS", name: "Last point of support", body: "A higher low after the breakout that holds." },
      { code: "UT / UTAD", name: "Upthrust", body: "A sweep above resistance that fails and traps demand." },
      { code: "SOW / LPSY", name: "Sign of weakness", body: "A breakdown or failed rally that starts markdown." },
    ],
    layersTitle: "How the workbench divides the work",
    layers: [
      { title: "Facts", body: "OHLCV, swings, ranges, volume and spread ratios are computed deterministically." },
      { title: "Interpretation", body: "The Agent names phases and events, then draws them back to the exact bars." },
      { title: "Execution", body: "Entry, stop, targets and risk/reward are rule-based, replayable and checkable." },
    ],
    cta: "Try it on a real chart",
  },
  cases: {
    kicker: "REAL CASES",
    title: "Two real price-volume structures",
    intro: "Charts and marks come from fixed historical windows; events are the workbench reading, not trade advice.",
    dataNote: "Data: TickFlow daily bars · fixed case window · method illustration only",
    disclaimer: "Past structure does not predict the future; every level is a research record.",
    aapl: {
      title: "Apple · shakeout, SOS and an upthrust",
      tag: "Re-accumulation → SOS / UT",
      window: "2026-06-15 → 2026-11-10",
      zoneLabel: "Re-accumulation",
      narrative:
        "31 Jul swept 299.74 and closed near the top of the bar on 2.6× volume; 299.74–322.37 became a re-accumulation range. 03 Nov tested 325.33 (LPS); 04 Nov closed 349.51 on 2.1× volume and +5.31% (SOS); 05 Nov printed 355.38 and closed in the bottom 16% (UT risk).",
      bullets: [
        "31 Jul shakeout 299.74 / 2.6× volume",
        "04 Nov SOS 349.51 / +5.31%",
        "05 Nov UT 355.38 / close in bottom 16%",
      ],
      levels: "Support 338.30 / 325.33 · Resistance 351.73 / 355.38",
    },
    maotai: {
      title: "Kweichow Moutai · accumulation then a volume breakout",
      tag: "Accumulation → SOS / UT",
      window: "2026-05-01 → 2026-11-10",
      zoneLabel: "Accumulation",
      narrative:
        "15 Jun–13 Jul ranged 1170.28–1234.78; 28 Jun swept 1151.01 and reclaimed. 02 Nov closed 1480.00 (SOS); 03 Nov printed 1480.60 then closed 1446.44 (UT); 10 Nov closed 1402.30.",
      bullets: [
        "15 Jun–13 Jul range 1170.28–1234.78",
        "28 Jun low 1151.01 / close 1194.96",
        "03 Nov high 1480.60; 10 Nov close 1402.30",
      ],
      levels: "Support 1359.97 · Resistance 1480.60",
    },
  },
  workbench: {
    kicker: "THE WORKBENCH",
    title: "A desk, not a black box.",
    body:
      "Five top actions, watchlist on the left, candles in the middle, read-only research and Agent tabs on the right.",
    features: [
      { title: "Read-only research", body: "Fundamentals, valuation and rules; no input, no credits." },
      { title: "Agent", body: "Reads and annotates structure with evidence." },
      { title: "Account", body: "3 free, permanent packs, referrals." },
      { title: "Language & theme", body: "English / 中文; annotations follow." },
    ],
    cta: "Open the workbench",
    imageAlt: "EasyWyckoff research workbench interface",
  },
  credits: {
    kicker: "START SMALL",
    title: "Start with 3 free analyses.",
    body:
      "Verify your email for 3 permanent analyses; each analysis or follow-up uses 1 credit and failures are refunded. Invite a verified new user and you both get 3 more.",
    free: "3 free analyses",
    invite: "Invite for 3 more",
    packs: "Permanent packs",
    cta: "Open the workbench",
    note: "Pack prices and contents are configured server-side by the operator; this page does not advertise a price.",
  },
  footer: {
    tagline: "EasyWyckoff · see the structure behind the price",
    method: "Wyckoff method",
    cases: "Real cases",
    workbench: "Workbench",
    docs: "Method notes",
    disclaimer: "Research and education only. Not investment advice. Market data may be delayed.",
    copyright: "© 2026 EasyWyckoff",
  },
  chart: {
    range: "Range",
    phase: "Phase",
    support: "Support",
    resistance: "Resistance",
    loading: "Reading the chart…",
    unavailable: "Case data is temporarily unavailable",
    data: "TickFlow daily",
    open: "Open in workbench",
  },
};

export const landingCopy: Record<Lang, LandingCopy> = { zh: zhCopy, en: enCopy };
