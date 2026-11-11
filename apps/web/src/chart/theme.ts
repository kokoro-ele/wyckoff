import type { DeepPartial, Styles } from "klinecharts";

export function getChartStyles(theme: "light" | "dark"): DeepPartial<Styles> {
const dark = theme === "dark";
const UP = dark ? "#f28ba3" : "#c34e68";
const DOWN = dark ? "#85d0af" : "#278268";
const GRID = dark ? "#3a313e" : "#eee7dc";
const AXIS = dark ? "#786878" : "#d8c8b9";
const TEXT_DIM = dark ? "#bba5b3" : "#88736b";
const TEXT = dark ? "#f6ecdf" : "#493e3b";
const PANEL = dark ? "#39313d" : "#fffdf7";
return {
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
      high: { color: TEXT_DIM, textSize: 10, textWeight: "500" },
      low: { color: TEXT_DIM, textSize: 10, textWeight: "500" },
      last: {
        upColor: UP,
        downColor: DOWN,
        noChangeColor: TEXT_DIM,
        line: { style: "dashed", dashedValue: [5, 4], size: 1 },
        text: { color: "#fffdf7", size: 11, weight: "600", borderRadius: 5 },
      },
    },
    tooltip: {
      showRule: "follow_cross",
      showType: "rect",
      rect: { color: PANEL, borderColor: AXIS, borderRadius: 10 },
      title: { show: true, color: TEXT, size: 11, weight: "600" },
      legend: { color: TEXT_DIM, size: 11 },
    },
  },
  indicator: {
    ohlc: { upColor: UP, downColor: DOWN },
    bars: [
      { upColor: UP, downColor: DOWN, noChangeColor: TEXT_DIM },
      { upColor: UP, downColor: DOWN, noChangeColor: TEXT_DIM },
    ],
    lines: [
      { color: "#f3bb5e", size: 1.2 },
      { color: "#a783ff", size: 1.2 },
      { color: "#4b91ff", size: 1.2 },
      { color: "#f05e9c", size: 1.2 },
      { color: "#59d5ca", size: 1.2 },
    ],
    tooltip: { showRule: "always", legend: { color: TEXT_DIM, size: 10 } },
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
  separator: { size: 1, color: AXIS, fill: true, activeBackgroundColor: dark ? "#533749" : "#fbe3eb" },
  crosshair: {
    horizontal: {
      line: { style: "dashed", dashedValue: [5, 4], size: 1, color: TEXT_DIM },
      text: { color: "#fffdf7", backgroundColor: dark ? "#4a4f59" : "#59616f", size: 11, borderRadius: 5 },
    },
    vertical: {
      line: { style: "dashed", dashedValue: [5, 4], size: 1, color: TEXT_DIM },
      text: { color: "#fffdf7", backgroundColor: dark ? "#4a4f59" : "#59616f", size: 11, borderRadius: 5 },
    },
  },
  overlay: {
    point: { color: "#b65b7e", borderColor: "#b65b7e66", activeColor: "#b65b7e" },
    line: { color: "#b65b7e", size: 1 },
    text: { color: TEXT, size: 11, backgroundColor: PANEL },
  },
};

}

export const chartStyles = getChartStyles("dark");
export const CHART_COLORS = { up: "#f28ba3", down: "#85d0af", axis: "#786878", textDim: "#bba5b3", text: "#f6ecdf" };
