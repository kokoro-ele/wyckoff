import { accumulationFixture } from "./src/__tests__/fixtures.js";
import { computeBarFeatures } from "./src/bars.js";
import { detectTradingRanges } from "./src/ranges.js";

const k = accumulationFixture();
console.log("bars:", k.length);
for (const r of detectTradingRanges(k, computeBarFeatures(k))) {
  console.log({
    start: r.startIndex, end: r.endIndex, bars: r.bars,
    support: r.support, resistance: r.resistance,
    er: r.efficiencyRatio, prior: r.priorTrend, hyp: r.hypothesis,
    pierces: r.pierces.map(p => `${p.index}:${p.side}:${p.recovered}`),
  });
}
