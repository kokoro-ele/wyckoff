/**
 * Wyckoff 结构事件词典。
 *
 * 这份词典是三处的唯一事实来源：Agent 系统提示词里的可用事件清单、
 * 标注渲染层的配色与文案、以及前端事件图例。任何新增事件只需改这里。
 */

export const WYCKOFF_EVENT_CODES = [
  // —— 吸筹（Accumulation）——
  "PS",
  "SC",
  "AR",
  "ST",
  "Spring",
  "Shakeout",
  "Test",
  "SOS",
  "LPS",
  "JAC",
  "BU",
  // —— 派发（Distribution）——
  "PSY",
  "BC",
  "UT",
  "UTAD",
  "SOW",
  "LPSY",
  "ICE",
] as const;

export type WyckoffEventCode = (typeof WYCKOFF_EVENT_CODES)[number];

export type WyckoffSide = "accumulation" | "distribution" | "both";
export type WyckoffBias = "bullish" | "bearish" | "neutral";
export type WyckoffPhase = "A" | "B" | "C" | "D" | "E";

export interface WyckoffEventMeta {
  code: WyckoffEventCode;
  nameEn: string;
  nameZh: string;
  side: WyckoffSide;
  /** 该事件通常出现在哪个阶段，用于提示词与一致性校验。 */
  phases: WyckoffPhase[];
  bias: WyckoffBias;
  description: string;
}

export const WYCKOFF_EVENTS: Record<WyckoffEventCode, WyckoffEventMeta> = {
  PS: {
    code: "PS",
    nameEn: "Preliminary Support",
    nameZh: "初步支撑",
    side: "accumulation",
    phases: ["A"],
    bias: "neutral",
    description: "下跌途中首次出现显著放量与扩张价差后的支撑，表明有大资金开始承接，但通常不是最低点。",
  },
  SC: {
    code: "SC",
    nameEn: "Selling Climax",
    nameZh: "抛售高潮",
    side: "accumulation",
    phases: ["A"],
    bias: "bullish",
    description: "恐慌性抛售达到极值：极大成交量、宽价差、收盘明显拉离最低点，是复合人大举吸货的痕迹。",
  },
  AR: {
    code: "AR",
    nameEn: "Automatic Rally",
    nameZh: "自动反弹",
    side: "both",
    phases: ["A"],
    bias: "neutral",
    description: "抛压枯竭后的技术性反弹（吸筹）或需求枯竭后的技术性回落（派发），其端点定义了后续交易区间的边界。",
  },
  ST: {
    code: "ST",
    nameEn: "Secondary Test",
    nameZh: "二次测试",
    side: "both",
    phases: ["A", "B"],
    bias: "neutral",
    description: "回到高潮区域测试供求：若量能与价差较高潮时明显收缩，说明抛压（或买盘）确已减弱。",
  },
  Spring: {
    code: "Spring",
    nameEn: "Spring",
    nameZh: "弹簧",
    side: "accumulation",
    phases: ["C"],
    bias: "bullish",
    description: "价格短暂跌破交易区间下沿随即快速收回，诱空并清洗浮筹，是 Phase C 的决定性测试。",
  },
  Shakeout: {
    code: "Shakeout",
    nameEn: "Shakeout",
    nameZh: "震仓",
    side: "accumulation",
    phases: ["C"],
    bias: "bullish",
    description: "比 Spring 更剧烈的向下穿刺，放量急跌后迅速收复，效果同为清洗弱手。",
  },
  Test: {
    code: "Test",
    nameEn: "Test",
    nameZh: "测试",
    side: "both",
    phases: ["C", "D"],
    bias: "neutral",
    description: "对前期低点（或高点）的缩量回踩，理想形态是低量窄幅、收盘回升，确认供给已枯竭。",
  },
  SOS: {
    code: "SOS",
    nameEn: "Sign of Strength",
    nameZh: "强势信号",
    side: "accumulation",
    phases: ["D"],
    bias: "bullish",
    description: "放量宽价差上涨并突破区间阻力，需求明显占优，标志 Phase D 启动。",
  },
  LPS: {
    code: "LPS",
    nameEn: "Last Point of Support",
    nameZh: "最后支撑点",
    side: "accumulation",
    phases: ["D"],
    bias: "bullish",
    description: "SOS 之后的缩量回踩且低点抬高，是介入的低风险位置。",
  },
  JAC: {
    code: "JAC",
    nameEn: "Jump Across the Creek",
    nameZh: "跳过小溪",
    side: "accumulation",
    phases: ["D"],
    bias: "bullish",
    description: "有力越过由区间高点连成的阻力线（小溪），SOS 的形象化表达。",
  },
  BU: {
    code: "BU",
    nameEn: "Back Up to the Edge of the Creek",
    nameZh: "回踩溪边",
    side: "accumulation",
    phases: ["D"],
    bias: "bullish",
    description: "跳过小溪后回抽确认，阻力翻转为支撑。",
  },
  PSY: {
    code: "PSY",
    nameEn: "Preliminary Supply",
    nameZh: "初步供给",
    side: "distribution",
    phases: ["A"],
    bias: "neutral",
    description: "上涨途中首次出现放量滞涨，大资金开始派发，但顶部尚未形成。",
  },
  BC: {
    code: "BC",
    nameEn: "Buying Climax",
    nameZh: "购买高潮",
    side: "distribution",
    phases: ["A"],
    bias: "bearish",
    description: "情绪高涨下的极大量上涨但收盘乏力，复合人借散户狂热出货。",
  },
  UT: {
    code: "UT",
    nameEn: "Upthrust",
    nameZh: "上冲回落",
    side: "distribution",
    phases: ["B"],
    bias: "bearish",
    description: "冲破区间上沿后迅速回落至区间内，诱多失败，供给仍在压制。",
  },
  UTAD: {
    code: "UTAD",
    nameEn: "Upthrust After Distribution",
    nameZh: "派发后上冲",
    side: "distribution",
    phases: ["C"],
    bias: "bearish",
    description: "派发结构末端的最后一次诱多突破，随后快速失败回落，是 Phase C 的决定性测试。",
  },
  SOW: {
    code: "SOW",
    nameEn: "Sign of Weakness",
    nameZh: "弱势信号",
    side: "distribution",
    phases: ["D"],
    bias: "bearish",
    description: "放量宽价差下跌并跌破区间支撑，供给明显占优。",
  },
  LPSY: {
    code: "LPSY",
    nameEn: "Last Point of Supply",
    nameZh: "最后供给点",
    side: "distribution",
    phases: ["D"],
    bias: "bearish",
    description: "SOW 之后的乏力反弹且高点降低，是做空或离场的低风险位置。",
  },
  ICE: {
    code: "ICE",
    nameEn: "Break the Ice",
    nameZh: "跌破冰面",
    side: "distribution",
    phases: ["D"],
    bias: "bearish",
    description: "跌破由区间低点连成的支撑线（冰面），随后回抽确认阻力。",
  },
};

export const WYCKOFF_PHASES: Record<WyckoffPhase, { nameZh: string; description: string }> = {
  A: {
    nameZh: "阶段 A · 前趋势停止",
    description: "前期趋势的抛压（或买盘）被耗尽，由 PS/SC/AR/ST（或 PSY/BC/AR/ST）划定交易区间的初始边界。",
  },
  B: {
    nameZh: "阶段 B · 构建原因",
    description: "复合人在区间内反复吸筹（或派发）。价格来回震荡、多次二次测试，是耗时最长的阶段，即因果法则中的「因」。",
  },
  C: {
    nameZh: "阶段 C · 决定性测试",
    description: "通过 Spring/Shakeout（或 UTAD）对区间边界做最后一次诱骗性突破，检验剩余供给（或需求）。",
  },
  D: {
    nameZh: "阶段 D · 趋势确立",
    description: "需求（或供给）取得主导。价格以 SOS/LPS（或 SOW/LPSY）的节奏离开区间，是胜率最高的介入窗口。",
  },
  E: {
    nameZh: "阶段 E · 区间之外",
    description: "价格已脱离区间进入明确的上涨（或下跌）趋势，「果」开始兑现。",
  },
};

export const WYCKOFF_LAWS = [
  {
    name: "供求法则",
    description: "需求大于供给则价格上涨，反之下跌。通过价差与成交量的关系读出两者力量对比。",
  },
  {
    name: "因果法则",
    description: "交易区间内的横盘时间与幅度构成「因」，突破后的行情幅度构成「果」。因越大，果越大。",
  },
  {
    name: "努力与结果法则",
    description: "成交量是努力，价格变动是结果。二者背离（如放巨量却收窄幅十字星）预示趋势即将转折。",
  },
] as const;
