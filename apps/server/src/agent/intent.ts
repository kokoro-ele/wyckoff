import type { ChatContext, ResearchIntent } from "@wyckoff/shared";

const EVENT_WORDS = /\b(PS|SC|AR|ST|Spring|Shakeout|Test|SOS|LPS|JAC|BU|PSY|BC|UTAD|UT|SOW|LPSY|ICE)\b/i;
const TRADE_WORDS = /买|卖|交易|计划|止损|止盈|目标|仓位|入场|出场|做多|做空|breakout|entry|stop|target|position|trade|long|short/i;
const CORRECTION_WORDS = /不对|错了|弄错|纠正|应该是|不是.{0,12}而是|标错|日期.{0,8}(差|错|不对)|\bwrong\b|\bcorrection\b|\bactually\b/i;
const VERIFY_WORDS = /核对|验证|检查|确认|是否|真的|对不对|为什么|依据|证据|量比|收盘位置|日期|confirm|verify|check|really|evidence/i;
const STRUCTURE_WORDS = /结构|区间|趋势|支撑|阻力|阶段|吸筹|派发|走势|形态|量价|structure|range|trend|support|resistance|phase|accumulation|distribution/i;

export function detectIntent(message: string, context?: ChatContext): ResearchIntent {
  if (CORRECTION_WORDS.test(message)) return "correction";
  if (TRADE_WORDS.test(message)) return "trade";
  if (EVENT_WORDS.test(message)) return "event";
  if (VERIFY_WORDS.test(message)) return "verification";
  if (STRUCTURE_WORDS.test(message)) return "structure";
  if (context) return "verification";
  return "general";
}

export function planForIntent(intent: ResearchIntent, language: "zh" | "en"): string[] {
  const plans: Record<ResearchIntent, { zh: string[]; en: string[] }> = {
    correction: {
      zh: ["读取上次结论和用户纠正", "核对相关 K 线、日期与标注", "修正标注或结论", "记录这次纠正"],
      en: ["Read the previous conclusion and the correction", "Check the relevant bars, dates and annotations", "Fix the annotation or conclusion", "Record the correction"],
    },
    verification: {
      zh: ["确认要验证的具体结论", "读取对应 K 线与已有标注", "逐项核对日期、价格和量价证据", "指出一致和不一致的地方"],
      en: ["Identify the claim to verify", "Read the relevant bars and existing annotations", "Check dates, prices and volume evidence", "State what agrees and what does not"],
    },
    trade: {
      zh: ["确认当前结构与关键价位", "核对最近的价格行为", "计算触发、止损和目标", "保存可验证的交易计划"],
      en: ["Confirm the structure and key levels", "Check recent price behaviour", "Calculate trigger, stop and targets", "Save a checkable trade plan"],
    },
    event: {
      zh: ["定位相关交易区间", "核对事件 K 线的量价证据", "判断事件是否成立", "标注并说明反证"],
      en: ["Locate the relevant trading range", "Check the event bar's price-volume evidence", "Decide whether the event is valid", "Annotate it and state counter-evidence"],
    },
    structure: {
      zh: ["确认研究范围与当前问题", "读取需要的区间和摆动点数据", "识别阶段与关键事件", "标注结构并总结"],
      en: ["Confirm the scope and question", "Read the ranges and swing points that are needed", "Identify the phase and key events", "Annotate the structure and summarise"],
    },
    general: {
      zh: ["理解当前问题", "按需读取行情或资料", "回答并记录结论"],
      en: ["Understand the question", "Read market data or references only if needed", "Answer and record the conclusion"],
    },
  };
  return plans[intent][language];
}
