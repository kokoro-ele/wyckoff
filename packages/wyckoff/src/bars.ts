import { FEATURE_THRESHOLDS, type BarFeature, type Kline, type NotableBar } from "./types.js";

const {
  climaxVolumeRatio: CLIMAX_VOLUME,
  dryUpVolumeRatio: DRY_UP_VOLUME,
  wideSpreadRatio: WIDE_SPREAD,
  narrowSpreadRatio: NARROW_SPREAD,
} = FEATURE_THRESHOLDS;

/**
 * 逐根 K 线的量价特征（Volume Spread Analysis）。
 *
 * 所有比值都以「之前 lookback 根」为基准而非包含当根，这样一根异常巨量
 * 不会把自己的基准也抬上去，量比才能真实反映相对于常态的偏离。
 */
export function computeBarFeatures(klines: Kline[], lookback = 20): BarFeature[] {
  const n = klines.length;
  const features: BarFeature[] = new Array(n);

  let spreadSum = 0;
  let volumeSum = 0;

  for (let i = 0; i < n; i++) {
    const bar = klines[i];
    const spread = bar.high - bar.low;
    const windowStart = Math.max(0, i - lookback);
    const windowSize = i - windowStart;

    const avgSpread = windowSize > 0 ? spreadSum / windowSize : spread;
    const avgVolume = windowSize > 0 ? volumeSum / windowSize : bar.volume;

    const spreadRatio = avgSpread > 0 ? spread / avgSpread : 1;
    const volumeRatio = avgVolume > 0 ? bar.volume / avgVolume : 1;
    const closePosition = spread > 0 ? (bar.close - bar.low) / spread : 0.5;
    const bodyRatio = spread > 0 ? Math.abs(bar.close - bar.open) / spread : 0;
    const prevClose = i > 0 ? klines[i - 1].close : bar.open;
    const changePct = prevClose !== 0 ? ((bar.close - prevClose) / prevClose) * 100 : 0;

    const isWideSpread = spreadRatio >= WIDE_SPREAD;
    const isNarrowSpread = spreadRatio <= NARROW_SPREAD;
    const isClimacticVolume = volumeRatio >= CLIMAX_VOLUME;
    const isVolumeDryUp = volumeRatio <= DRY_UP_VOLUME;

    let effortVsResult: BarFeature["effortVsResult"] = "aligned";
    if (isClimacticVolume && isNarrowSpread) effortVsResult = "no_result";
    else if (isVolumeDryUp && isWideSpread) effortVsResult = "no_effort";

    features[i] = {
      index: i,
      timestamp: bar.timestamp,
      spreadRatio: round(spreadRatio, 2),
      closePosition: round(closePosition, 2),
      bodyRatio: round(bodyRatio, 2),
      volumeRatio: round(volumeRatio, 2),
      changePct: round(changePct, 2),
      isWideSpread,
      isNarrowSpread,
      isClimacticVolume,
      isVolumeDryUp,
      effortVsResult,
    };

    // 滚动窗口维护放在最后，保证当根不参与自己的基准。
    spreadSum += spread;
    volumeSum += bar.volume;
    if (i - windowStart >= lookback) {
      spreadSum -= klines[windowStart].high - klines[windowStart].low;
      volumeSum -= klines[windowStart].volume;
    }
  }

  return features;
}

/**
 * 从全部 K 线里挑出真正值得 Agent 关注的那几十根，并给出中文理由。
 * 目的是把「读图」这件事变成读一份结构化清单，而不是让模型去数 500 根 K 线。
 */
export function pickNotableBars(klines: Kline[], features: BarFeature[], limit = 40): NotableBar[] {
  const scored: { bar: NotableBar; score: number }[] = [];

  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const k = klines[i];
    const reasons: string[] = [];
    let score = 0;

    if (f.isClimacticVolume) {
      const dir = f.changePct >= 0 ? "上涨" : "下跌";
      reasons.push(`高潮量（${f.volumeRatio.toFixed(1)}倍均量）伴随${dir}`);
      score += f.volumeRatio;
    }
    if (f.isWideSpread && f.volumeRatio >= 1.5) {
      reasons.push(`宽价差放量（价差 ${f.spreadRatio.toFixed(1)} 倍）`);
      score += f.spreadRatio;
    }
    if (f.effortVsResult === "no_result") {
      reasons.push("努力与结果背离：放巨量却收窄幅，上下方存在对手盘");
      score += 3;
    }
    if (f.effortVsResult === "no_effort") {
      reasons.push("无量大幅波动：该方向缺乏真实承接");
      score += 1.5;
    }
    if (f.volumeRatio >= 1.8 && f.closePosition >= 0.75 && f.changePct < 0) {
      reasons.push("放量下探但收在上沿，出现承接迹象");
      score += 2.5;
    }
    if (f.volumeRatio >= 1.8 && f.closePosition <= 0.25 && f.changePct > 0) {
      reasons.push("放量冲高但收在下沿，遭遇供给压制");
      score += 2.5;
    }
    if (f.isVolumeDryUp && f.isNarrowSpread) {
      reasons.push("缩量窄幅，供给枯竭型测试");
      score += 1;
    }

    if (reasons.length > 0) {
      scored.push({
        bar: { ...f, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume, reasons },
        score,
      });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.bar)
    .sort((a, b) => a.index - b.index);
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
