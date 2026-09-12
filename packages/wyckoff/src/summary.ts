import { computeBarFeatures } from "./bars.js";
import { efficiencyRatio, mean } from "./indicators.js";
import type { BarFeature, Kline, MarketFeatures, TradingRange } from "./types.js";

/**
 * 把毫秒时间戳格式化成日期串。
 *
 * 日线及以上的 K 线时间戳落在 UTC 零点，直接取 ISO 的日期部分就是交易日。
 * 给 LLM 看日期而不是 13 位数字，既省 token 又大幅降低它引用错 K 线的概率。
 */
export function formatBarTime(timestamp: number, period: string): string {
  const iso = new Date(timestamp).toISOString();
  // 分钟/小时级周期带时刻；"1M" 是月线（大写 M，不匹配），只显示日期。
  const intraday = /^\d+m$/.test(period);
  return intraday ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

/**
 * 价格格式化。
 *
 * 复权后的价格常带一长串浮点尾巴（1369.0119213873595），原样喂给模型既浪费 token
 * 又会诱导它在回答里复读这种无意义的精度。按量级取合适的小数位。
 */
export function px(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 3 : 4;
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

/** 把整份 MarketFeatures 渲染成给 Agent 阅读的 Markdown 摘要。 */
export function renderFeatureSummary(f: MarketFeatures): string {
  if (f.barCount === 0) return "该标的在所选区间内没有数据。";

  const t = (ts: number) => formatBarTime(ts, f.period);
  const lines: string[] = [];

  lines.push(`## ${f.symbol} · ${f.period} 结构摘要`);
  lines.push(
    `特征引擎 v${f.engine.version}；ZigZag ${f.engine.options.swingAtrMultiple}×ATR，` +
      `区间最少 ${f.engine.options.minRangeBars} 根、效率比上限 ${f.engine.options.maxRangeEfficiency}，` +
      `高潮量阈值 ${f.engine.thresholds.climaxVolumeRatio}×、宽价差阈值 ${f.engine.thresholds.wideSpreadRatio}×。`,
  );
  lines.push(
    `区间 ${t(f.startTime)} ~ ${t(f.endTime)}，共 ${f.barCount} 根。` +
      `收盘 ${px(f.price.first)} → ${px(f.price.last)}（全窗口 ${signed(f.price.changePct)}%，` +
      `最近 60 根 ${signed(f.price.recentChangePct)}%），` +
      `最高 ${px(f.price.max)} / 最低 ${px(f.price.min)}。`,
  );
  lines.push(
    `当前 ATR ${px(f.atr.current)}（占价 ${f.atr.currentPct}%）。` +
      `均量 ${compactNumber(f.volume.mean)}，最近 10 根量能为此前均量的 ${f.volume.recentRatio} 倍。`,
  );
  lines.push(
    `均线：MA20 ${px(f.trend.ma20)} / MA50 ${px(f.trend.ma50)} / MA200 ${px(f.trend.ma200)}；` +
      `短期${trendZh(f.trend.shortTerm)}、中期${trendZh(f.trend.mediumTerm)}、长期${trendZh(f.trend.longTerm)}。`,
  );

  if (f.relativeStrength) {
    const rs = f.relativeStrength;
    lines.push(
      `相对强度：近 ${rs.lookbackBars} 根相对基准 ${rs.benchmark} 的超额收益 ${signed(rs.excessReturnPct)} 个百分点，` +
        `${rs.outperforming ? "跑赢" : "跑输"}大盘。`,
    );
  }

  if (f.tradingRanges.length > 0) {
    lines.push("");
    lines.push("### 已检测到的横盘交易区间");
    lines.push("（上下沿由反复触及的摆动点聚簇而来，越出边界的短暂穿刺单独列在「边界穿刺」里）");
    for (const [i, r] of f.tradingRanges.entries()) {
      lines.push(renderRange(r, i + 1, f.period));
    }
  } else {
    lines.push("");
    lines.push("### 横盘交易区间");
    lines.push("未检测到符合条件的横盘区间，该段行情以趋势运动为主。");
  }

  if (f.swings.length > 0) {
    lines.push("");
    lines.push("### 摆动高低点（ATR 自适应 ZigZag）");
    for (const s of f.swings.slice(-24)) {
      lines.push(
        `- ${t(s.timestamp)} ${s.type === "high" ? "高点" : "低点"} ${px(s.price)}` +
          (s.bars > 0 ? `（较上一枢轴 ${signed(s.changePct)}%，历时 ${s.bars} 根）` : ""),
      );
    }
  }

  if (f.notableBars.length > 0) {
    lines.push("");
    lines.push("### 量价异常 K 线");
    for (const b of f.notableBars) {
      lines.push(
        `- ${t(b.timestamp)} 收 ${px(b.close)}（${signed(b.changePct)}%）` +
          ` 量比 ${b.volumeRatio} 价差比 ${b.spreadRatio} 收盘位置 ${b.closePosition}` +
          ` — ${b.reasons.join("；")}`,
      );
    }
  }

  return lines.join("\n");
}

function renderRange(r: TradingRange, ordinal: number, period: string): string {
  const t = (ts: number) => formatBarTime(ts, period);
  const parts = [
    `- 区间${ordinal}：${t(r.startTime)} ~ ${t(r.endTime)}（${r.bars} 根）`,
    `支撑 ${px(r.support)} / 阻力 ${px(r.resistance)}，高度 ${r.heightPct}%，效率比 ${r.efficiencyRatio}`,
    `上沿触及 ${r.touchesTop} 次、下沿触及 ${r.touchesBottom} 次`,
    `区间内均量为进入前的 ${r.volumeVsBefore} 倍`,
    `前期走势${trendZh(r.priorTrend)}，初步倾向：${hypothesisZh(r.hypothesis)}`,
  ];
  let out = parts.join("；");

  if (r.pierces.length > 0) {
    const pierceText = r.pierces
      .slice(0, 8)
      .map(
        (p) =>
          `${t(p.timestamp)} ${p.side === "below" ? "下破" : "上破"}${p.depthPct}%` +
          `（量比 ${p.volumeRatio}，${p.recovered ? "当根收回区间内" : "未收回"}）`,
      )
      .join("，");
    out += `\n  · 边界穿刺：${pierceText}`;
    out += `\n  · 提示：下破后当根收回且量能配合，是 Spring/Shakeout 的形态前提；上破后当根收回则是 UT/UTAD 的形态前提。最终定性需结合所处阶段判断。`;
  }
  return out;
}

/** 用户框选了一段区间时，为这段生成聚焦摘要。 */
export function summarizeSelectedRange(
  klines: Kline[],
  period: string,
  startTime: number,
  endTime: number,
  priceLow?: number,
  priceHigh?: number,
): string {
  const slice = klines.filter((b) => b.timestamp >= startTime && b.timestamp <= endTime);
  if (slice.length === 0) return "用户选中的区间内没有 K 线数据。";

  const t = (ts: number) => formatBarTime(ts, period);
  const features = computeBarFeatures(slice, Math.min(20, Math.max(5, Math.floor(slice.length / 3))));
  const highs = slice.map((b) => b.high);
  const lows = slice.map((b) => b.low);
  const closes = slice.map((b) => b.close);
  const first = slice[0];
  const last = slice[slice.length - 1];
  const er = efficiencyRatio(closes);

  const lines: string[] = [];
  lines.push(`用户在图上框选了 ${t(first.timestamp)} ~ ${t(last.timestamp)} 这一段，共 ${slice.length} 根 K 线。`);
  if (priceLow !== undefined && priceHigh !== undefined) {
    lines.push(`框选的价格范围是 ${px(priceLow)} ~ ${px(priceHigh)}。`);
  }
  lines.push(
    `该段最高 ${px(Math.max(...highs))} / 最低 ${px(Math.min(...lows))}，` +
      `收盘 ${px(first.close)} → ${px(last.close)}（${signed(((last.close - first.close) / first.close) * 100)}%），` +
      `效率比 ${round(er, 3)}（越接近 0 越像横盘震荡，越接近 1 越像单边趋势）。`,
  );
  lines.push(`该段均量 ${compactNumber(mean(slice.map((b) => b.volume)))}。`);

  const notable = features
    .map((f, i) => ({ f, k: slice[i] }))
    .filter(({ f }) => f.isClimacticVolume || f.isWideSpread || f.effortVsResult !== "aligned")
    .slice(0, 12);

  if (notable.length > 0) {
    lines.push("段内量价异常 K 线：");
    for (const { f, k } of notable) {
      lines.push(`- ${t(k.timestamp)} 收 ${px(k.close)} 量比 ${f.volumeRatio} 价差比 ${f.spreadRatio} 收盘位置 ${f.closePosition}`);
    }
  }
  return lines.join("\n");
}

/** 用户点选了单根 K 线时，为这根生成明细。 */
export function summarizeSelectedBar(klines: Kline[], period: string, timestamp: number): string {
  const features = computeBarFeatures(klines);
  const index = nearestIndex(klines, timestamp);
  if (index < 0) return "用户选中的 K 线不在当前数据范围内。";

  const k = klines[index];
  const f = features[index];
  const prev = index > 0 ? klines[index - 1] : undefined;

  const lines: string[] = [];
  lines.push(`用户点选了 ${formatBarTime(k.timestamp, period)} 这一根 K 线：`);
  lines.push(`开 ${px(k.open)} 高 ${px(k.high)} 低 ${px(k.low)} 收 ${px(k.close)}，成交量 ${compactNumber(k.volume)}。`);
  if (prev) lines.push(`前收 ${px(prev.close)}，涨跌 ${signed(f.changePct)}%。`);
  lines.push(
    `量比 ${f.volumeRatio}（相对前 20 根均量）、价差比 ${f.spreadRatio}、` +
      `收盘位置 ${f.closePosition}（0=收在最低，1=收在最高）、实体占比 ${f.bodyRatio}。`,
  );
  lines.push(`努力与结果：${effortZh(f.effortVsResult)}。`);

  const tags: string[] = [];
  if (f.isClimacticVolume) tags.push("高潮量");
  if (f.isVolumeDryUp) tags.push("量能枯竭");
  if (f.isWideSpread) tags.push("宽价差");
  if (f.isNarrowSpread) tags.push("窄价差");
  if (tags.length > 0) lines.push(`特征标签：${tags.join("、")}。`);

  const context = klines.slice(Math.max(0, index - 5), Math.min(klines.length, index + 6));
  lines.push("前后各 5 根的收盘与成交量：");
  for (const c of context) {
    lines.push(`- ${formatBarTime(c.timestamp, period)} 收 ${px(c.close)} 量 ${compactNumber(c.volume)}${c.timestamp === k.timestamp ? "  ← 选中" : ""}`);
  }
  return lines.join("\n");
}

/** 找出与目标时间戳最接近的 K 线下标，用于把用户点击/模型给的日期吸附到真实 K 线上。 */
export function nearestIndex(klines: Kline[], timestamp: number): number {
  if (klines.length === 0) return -1;
  let lo = 0;
  let hi = klines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (klines[mid].timestamp < timestamp) lo = mid + 1;
    else hi = mid;
  }
  const candidates = [lo - 1, lo].filter((i) => i >= 0 && i < klines.length);
  return candidates.reduce((best, i) =>
    Math.abs(klines[i].timestamp - timestamp) < Math.abs(klines[best].timestamp - timestamp) ? i : best,
  );
}

export type { BarFeature };

function trendZh(v: "up" | "down" | "flat"): string {
  return v === "up" ? "向上" : v === "down" ? "向下" : "走平";
}

function hypothesisZh(v: TradingRange["hypothesis"]): string {
  return v === "accumulation" ? "可能是吸筹" : v === "distribution" ? "可能是派发" : "方向不明";
}

function effortZh(v: BarFeature["effortVsResult"]): string {
  if (v === "no_result") return "背离——放巨量却没走出幅度，存在对手盘";
  if (v === "no_effort") return "背离——几乎无量却大幅波动，该方向缺乏承接";
  return "一致";
}

function signed(v: number): string {
  const r = round(v, 2);
  return r > 0 ? `+${r}` : `${r}`;
}

function compactNumber(v: number): string {
  if (!Number.isFinite(v)) return "-";
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(2)}万`;
  return `${Math.round(v)}`;
}

function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
