import type { Kline } from "./types.js";

/** 简单移动平均。前 period-1 项为 NaN。 */
export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** 指数移动平均，用 SMA 作为种子。 */
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  out[period - 1] = seed / period;
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

export function trueRange(klines: Kline[]): number[] {
  return klines.map((bar, i) => {
    if (i === 0) return bar.high - bar.low;
    const prevClose = klines[i - 1].close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
  });
}

/** Wilder 平滑的 ATR。 */
export function atr(klines: Kline[], period = 14): number[] {
  const tr = trueRange(klines);
  const out = new Array<number>(klines.length).fill(NaN);
  if (klines.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  out[period - 1] = sum / period;
  for (let i = period; i < klines.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  }
  return out;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

export function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) acc += (v - m) ** 2;
  return Math.sqrt(acc / (values.length - 1));
}

/**
 * Kaufman 效率比：净位移 / 路径总长。
 * 趋势行情接近 1，横盘震荡接近 0，是识别交易区间最省事也最稳的判据。
 */
export function efficiencyRatio(values: number[]): number {
  if (values.length < 2) return 1;
  const net = Math.abs(values[values.length - 1] - values[0]);
  let path = 0;
  for (let i = 1; i < values.length; i++) path += Math.abs(values[i] - values[i - 1]);
  if (path === 0) return 0;
  return net / path;
}

/** 最小二乘斜率，已按均值归一化为「每根 K 线变动的百分比」。 */
export function normalizedSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const avgY = mean(values);
  if (avgY === 0) return 0;
  const avgX = (n - 1) / 2;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - avgX) * (values[i] - avgY);
    den += (i - avgX) ** 2;
  }
  if (den === 0) return 0;
  return ((num / den) / avgY) * 100;
}

/** 线性插值分位数，p ∈ [0,1]。 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * Math.min(Math.max(p, 0), 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function lastFinite(values: number[]): number {
  for (let i = values.length - 1; i >= 0; i--) {
    if (Number.isFinite(values[i])) return values[i];
  }
  return NaN;
}
