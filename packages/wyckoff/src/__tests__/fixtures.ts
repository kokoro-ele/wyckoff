import type { Kline } from "../types.js";

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);

export function makeKline(index: number, open: number, high: number, low: number, close: number, volume: number): Kline {
  return {
    timestamp: START + index * DAY,
    open,
    high,
    low,
    close,
    volume,
    amount: close * volume,
  };
}

/** 在给定收盘价序列上生成一串 K 线，影线按 wick 比例展开。 */
export function fromCloses(closes: number[], volumes?: number[], wick = 0.01): Kline[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    const hi = Math.max(open, close) * (1 + wick);
    const lo = Math.min(open, close) * (1 - wick);
    return makeKline(i, open, hi, lo, close, volumes?.[i] ?? 1_000_000);
  });
}

/** 从当前值出发，分段线性走到每个目标值，模拟真实走势里的多根 K 线一条腿。 */
function walkLegs(from: number, targets: number[], barsPerLeg: number): number[] {
  const out: number[] = [];
  let current = from;
  for (const target of targets) {
    for (let i = 1; i <= barsPerLeg; i++) {
      out.push(current + ((target - current) * i) / barsPerLeg);
    }
    current = target;
  }
  return out;
}

/**
 * 一段教科书式的吸筹结构，供区间检测与 Spring 识别测试使用：
 * 下跌 → 抛售高潮 → 自动反弹 → 长时间横盘 → 弹簧下破回收 → 放量突破。
 *
 * 横盘段刻意用「多根 K 线走完一条腿」的方式生成而不是逐根反向跳动，
 * 这样才有真实走势里那种可被 ZigZag 识别的摆动结构。
 */
export function accumulationFixture(): Kline[] {
  const closes: number[] = [];
  const volumes: number[] = [];

  // 1) 40 根下跌：100 → 63
  for (let i = 0; i < 40; i++) {
    closes.push(100 - i * 0.95);
    volumes.push(1_000_000 + i * 8_000);
  }
  // 2) 抛售高潮：急跌后收在上沿，成交量爆发
  closes.push(58);
  volumes.push(6_000_000);
  // 3) 自动反弹到 72（6 根）
  for (let i = 0; i < 6; i++) {
    closes.push(58 + (i + 1) * 2.4);
    volumes.push(2_500_000 - i * 200_000);
  }
  // 4) 50 根横盘：在 64 ~ 71.5 之间走十条腿，量能逐步萎缩
  const band = walkLegs(72.4, [64.2, 71.2, 64.8, 71.5, 63.9, 70.8, 64.5, 71.0, 64.3, 70.6], 5);
  for (const [i, value] of band.entries()) {
    closes.push(value);
    volumes.push(1_400_000 - i * 12_000);
  }
  // 5) 弹簧：下破支撑到 59.5，当根收回区间内
  closes.push(64.2);
  volumes.push(2_800_000);
  // 6) 缩量测试
  closes.push(65);
  volumes.push(700_000);
  closes.push(66.5);
  volumes.push(650_000);
  // 7) 放量突破（SOS）
  for (let i = 0; i < 12; i++) {
    closes.push(72 + i * 1.6);
    volumes.push(3_200_000 - i * 90_000);
  }

  const klines = fromCloses(closes, volumes, 0.008);

  // 手工加深抛售高潮与弹簧的下影线，让它们具备穿刺形态。
  klines[SC_INDEX] = { ...klines[SC_INDEX], open: 62.9, high: 63.5, low: 55.5, close: 58 };
  klines[SPRING_INDEX] = { ...klines[SPRING_INDEX], open: 63, high: 64.5, low: 59.5, close: 64.2 };

  return klines;
}

/** 抛售高潮所在下标。 */
export const SC_INDEX = 40;
/** 弹簧所在下标：40(SC) + 6(AR) + 50(横盘) + 1。 */
export const SPRING_INDEX = 97;
/** 突破起始下标。 */
export const BREAKOUT_INDEX = 100;
