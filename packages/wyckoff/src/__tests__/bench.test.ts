/**
 * 手动性能基准。通过 `pnpm -F @wyckoff/wyckoff bench` 运行，不进入日常单测。
 * 用合成数据模拟服务器实际加载量级：日线 10000 根（MAX_COUNT 上限）。
 */
import { describe, expect, it } from "vitest";
import { computeFeatures } from "../features.js";
import { detectSwings } from "../swings.js";
import { detectTradingRanges } from "../ranges.js";
import { computeBarFeatures } from "../bars.js";
import { sma, ema, atr, efficiencyRatio, normalizedSlope } from "../indicators.js";
import type { Kline } from "../types.js";

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 生成带波动聚集（GARCH 感）的合成行情：横盘段 + 趋势段交替，量能与波幅联动。 */
function synthKlines(n: number, seed: number): Kline[] {
  const rnd = mulberry32(seed);
  const DAY = 86_400_000;
  const out: Kline[] = new Array(n);
  let close = 50;
  let vol = 0.02;
  let regime = 0; // 0 横盘 1 上涨 2 下跌
  for (let i = 0; i < n; i++) {
    if (i % 400 === 0) regime = Math.floor(rnd() * 3);
    const drift = regime === 1 ? 0.002 : regime === 2 ? -0.002 : 0;
    vol = vol * 0.95 + (rnd() * 0.02) * 0.05; // 波动率缓慢变化
    const ret = drift + (rnd() - 0.5) * 2 * vol;
    const open = close;
    close = Math.max(1, close * (1 + ret));
    const hi = Math.max(open, close) * (1 + Math.abs(rnd()) * vol * 0.6);
    const lo = Math.min(open, close) * (1 - Math.abs(rnd()) * vol * 0.6);
    const volume = 1_000_000 * (0.5 + rnd() * 1.5) * (1 + vol * 30);
    out[i] = {
      timestamp: Date.UTC(2000, 0, 1) + i * DAY,
      open,
      high: hi,
      low: lo,
      close,
      volume,
      amount: close * volume,
    };
  }
  return out;
}

function time(label: string, fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

const runBenchmark =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.RUN_BENCHMARK === "1";
const benchmarkSuite = runBenchmark ? describe : describe.skip;

benchmarkSuite("bench", () => {
  for (const n of [1_000, 10_000]) {
    it(`n=${n}`, () => {
      const klines = synthKlines(n, 7);
      const closes = klines.map((b) => b.close);
      const times: [string, number][] = [];

      times.push(["sma(20)×3", time("", () => { sma(closes, 20); sma(closes, 50); sma(closes, 200); })]);
      times.push(["ema(20)", time("", () => ema(closes, 20))]);
      times.push(["atr(14)", time("", () => atr(klines, 14))]);
      times.push(["efficiencyRatio", time("", () => efficiencyRatio(closes))]);
      times.push(["normalizedSlope", time("", () => normalizedSlope(closes.slice(-200)))]);
      times.push(["computeBarFeatures", time("", () => computeBarFeatures(klines, 20))]);
      const barFeatures = computeBarFeatures(klines, 20);
      times.push(["detectSwings(2.5×)", time("", () => detectSwings(klines, 2.5, 14))]);
      times.push(["detectSwings(1.2×)", time("", () => detectSwings(klines, 1.2, 14))]);
      const swings = detectSwings(klines, 1.2, 14);
      times.push(["detectTradingRanges", time("", () => detectTradingRanges(klines, barFeatures))]);
      times.push(["computeFeatures(整条流水线)", time("", () => computeFeatures({ symbol: "T", period: "1d", klines }))]);

      const maxMs = Math.max(...times.map(([, ms]) => ms));
      const minMs = Math.min(...times.map(([, ms]) => ms));
      const avg = times.reduce((s, [, ms]) => s + ms, 0) / times.length;

      console.log(`\n=== n=${n}（摆动点数=${swings.length}）===\n` + times.map(([l, ms]) => `  ${l.padEnd(28)} ${ms.toFixed(2)} ms`).join("\n"));
      console.log(`  ${"整条流水线".padEnd(28)} ${avg.toFixed(2)} ms（min ${minMs.toFixed(2)} / max ${maxMs.toFixed(2)}）`);

      // 不为快慢设断言，只保证结果结构正确
      const f = computeFeatures({ symbol: "T", period: "1d", klines });
      expect(f.barCount).toBe(n);
      expect(f.price.last).toBeGreaterThan(0);
      expect(maxMs).toBeLessThan(60_000);
    });
  }
});
