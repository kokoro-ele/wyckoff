import type { DeepPartial, Styles } from "klinecharts";

const UP = "#ff6178";
const DOWN = "#28d9a9";
const GRID = "rgba(150, 184, 226, 0.055)";
const AXIS = "rgba(162, 193, 233, 0.13)";
const TEXT_DIM = "#74839a";
const TEXT = "#eef5ff";
const PANEL = "rgba(8, 14, 25, 0.94)";

/** 暗色玻璃主题。涨红跌绿，跟随 A 股习惯。 */
export const chartStyles: DeepPartial<Styles> = {
  grid: {
    show: true,
    horizontal: { show: true, size: 1, color: GRID, style: "solid" },
    vertical: { show: true, size: 1, color: GRID, style: "solid" },
  },
  candle: {
    type: "candle_up_stroke",
    bar: {
      compareRule: "current_open",
      upColor: UP,
      downColor: DOWN,
      noChangeColor: TEXT_DIM,
      upBorderColor: UP,
      downBorderColor: DOWN,
      noChangeBorderColor: TEXT_DIM,
      upWickColor: UP,
      downWickColor: DOWN,
      noChangeWickColor: TEXT_DIM,
    },
    priceMark: {
      high: { color: "#9ba9bd", textSize: 10, textWeight: "500" },
      low: { color: "#9ba9bd", textSize: 10, textWeight: "500" },
      last: {
        upColor: UP,
        downColor: DOWN,
        noChangeColor: TEXT_DIM,
        line: { style: "dashed", dashedValue: [5, 4], size: 1 },
        text: { color: "#07101b", size: 11, weight: "600", borderRadius: 5 },
      },
    },
    tooltip: {
      showRule: "follow_cross",
      showType: "rect",
      rect: { color: PANEL, borderColor: "rgba(126,184,246,0.22)", borderRadius: 10 },
      title: { show: true, color: TEXT, size: 11, weight: "600" },
      legend: { color: "#b3bfd0", size: 11 },
    },
  },
  indicator: {
    ohlc: { upColor: "rgba(255,97,120,0.72)", downColor: "rgba(40,217,169,0.72)" },
    bars: [
      { upColor: "rgba(255,97,120,0.62)", downColor: "rgba(40,217,169,0.62)", noChangeColor: TEXT_DIM },
      { upColor: "rgba(255,97,120,0.62)", downColor: "rgba(40,217,169,0.62)", noChangeColor: TEXT_DIM },
    ],
    lines: [
      { color: "#f3bb5e", size: 1.2 },
      { color: "#a783ff", size: 1.2 },
      { color: "#4b91ff", size: 1.2 },
      { color: "#f05e9c", size: 1.2 },
      { color: "#59d5ca", size: 1.2 },
    ],
    tooltip: { showRule: "always", legend: { color: "#8796ab", size: 10 } },
    lastValueMark: { show: false },
  },
  xAxis: {
    axisLine: { color: AXIS, size: 1 },
    tickLine: { color: AXIS, size: 1, length: 3 },
    tickText: { color: TEXT_DIM, size: 10 },
  },
  yAxis: {
    axisLine: { color: AXIS, size: 1 },
    tickLine: { color: AXIS, size: 1, length: 3 },
    tickText: { color: TEXT_DIM, size: 10 },
  },
  separator: { size: 1, color: AXIS, fill: true, activeBackgroundColor: "rgba(115, 182, 255, 0.13)" },
  crosshair: {
    horizontal: {
      line: { style: "dashed", dashedValue: [5, 4], size: 1, color: "rgba(143,199,255,0.48)" },
      text: { color: "#ffffff", backgroundColor: "rgba(31,53,82,0.96)", size: 11, borderRadius: 5 },
    },
    vertical: {
      line: { style: "dashed", dashedValue: [5, 4], size: 1, color: "rgba(143,199,255,0.48)" },
      text: { color: "#ffffff", backgroundColor: "rgba(31,53,82,0.96)", size: 11, borderRadius: 5 },
    },
  },
  overlay: {
    point: { color: "#5aa7ff", borderColor: "rgba(90, 167, 255, 0.35)", activeColor: "#5aa7ff" },
    line: { color: "#5aa7ff", size: 1 },
    text: { color: "#ffffff", size: 11, backgroundColor: PANEL },
  },
};

export const CHART_COLORS = { up: UP, down: DOWN, axis: AXIS, textDim: TEXT_DIM, text: TEXT };
