import { atr as computeAtr, mean } from "./indicators.js";
import type { Kline, SwingPoint } from "./types.js";

/**
 * ATR 自适应 ZigZag。
 *
 * 固定百分比阈值的 ZigZag 在低波动品种上会漏掉结构、在高波动品种上会噪声爆炸，
 * 所以这里用 `multiple × ATR` 作为反转确认阈值，让摆动点的显著性随波动率自动伸缩。
 */
export function detectSwings(klines: Kline[], multiple = 2.5, atrPeriod = 14): SwingPoint[] {
  const n = klines.length;
  if (n < 3) return [];

  const atrValues = computeAtr(klines, atrPeriod);
  const finiteAtr = atrValues.filter(Number.isFinite);
  const fallbackAtr = finiteAtr.length > 0 ? mean(finiteAtr) : mean(klines.map((b) => b.high - b.low));

  const threshold = (i: number): number => {
    const a = Number.isFinite(atrValues[i]) ? atrValues[i] : fallbackAtr;
    return Math.max(a * multiple, klines[i].close * 1e-4);
  };

  // —— 确定初始方向 —— 先找出第一段达到阈值的运动，据此锚定第一个枢轴。
  let hiIdx = 0;
  let loIdx = 0;
  let dir: "up" | "down" | null = null;
  let start = 1;

  for (let i = 1; i < n; i++) {
    if (klines[i].high > klines[hiIdx].high) hiIdx = i;
    if (klines[i].low < klines[loIdx].low) loIdx = i;
    const th = threshold(i);
    if (hiIdx > loIdx && klines[hiIdx].high - klines[loIdx].low >= th) {
      dir = "up";
      start = hiIdx;
      break;
    }
    if (loIdx > hiIdx && klines[hiIdx].high - klines[loIdx].low >= th) {
      dir = "down";
      start = loIdx;
      break;
    }
  }
  if (dir === null) return [];

  const raw: { index: number; type: "high" | "low"; price: number }[] = [];
  const anchorIdx = dir === "up" ? loIdx : hiIdx;
  raw.push({
    index: anchorIdx,
    type: dir === "up" ? "low" : "high",
    price: dir === "up" ? klines[anchorIdx].low : klines[anchorIdx].high,
  });

  let extremeIdx = start;
  let extremeVal = dir === "up" ? klines[start].high : klines[start].low;

  for (let i = start + 1; i < n; i++) {
    const th = threshold(i);
    if (dir === "up") {
      if (klines[i].high >= extremeVal) {
        extremeVal = klines[i].high;
        extremeIdx = i;
      } else if (extremeVal - klines[i].low >= th) {
        raw.push({ index: extremeIdx, type: "high", price: extremeVal });
        dir = "down";
        extremeVal = klines[i].low;
        extremeIdx = i;
      }
    } else {
      if (klines[i].low <= extremeVal) {
        extremeVal = klines[i].low;
        extremeIdx = i;
      } else if (klines[i].high - extremeVal >= th) {
        raw.push({ index: extremeIdx, type: "low", price: extremeVal });
        dir = "up";
        extremeVal = klines[i].high;
        extremeIdx = i;
      }
    }
  }

  // 收尾：把尚未被反向运动确认的最新极值也带上。最近这条腿往往正是分析重点。
  const lastRaw = raw[raw.length - 1];
  if (lastRaw && extremeIdx > lastRaw.index) {
    raw.push({ index: extremeIdx, type: dir === "up" ? "high" : "low", price: extremeVal });
  }

  return raw.map((p, i) => {
    const prev = i > 0 ? raw[i - 1] : undefined;
    return {
      index: p.index,
      timestamp: klines[p.index].timestamp,
      price: p.price,
      type: p.type,
      changePct: prev && prev.price !== 0 ? ((p.price - prev.price) / prev.price) * 100 : 0,
      bars: prev ? p.index - prev.index : 0,
    } satisfies SwingPoint;
  });
}
