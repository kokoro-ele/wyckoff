import {
  type WyckoffBias,
  type WyckoffEventCode,
  WYCKOFF_EVENTS,
  type WyckoffPhase,
} from "@wyckoff/shared";
import type { Coordinate, OverlayFigure, OverlayTemplate } from "klinecharts";
import { registerOverlay } from "klinecharts";

export const ZONE_OVERLAY = "wyckoffZone";
export const EVENT_TAG_OVERLAY = "wyckoffEventTag";

/** 阶段配色。A/C 是转折段用暖色，B 是构建段用中性，D/E 是趋势确立段用冷色。 */
const PHASE_COLORS: Record<WyckoffPhase, string> = {
  A: "#e8a33d",
  B: "#7d8aa3",
  C: "#c77dff",
  D: "#4d8dff",
  E: "#1fbf9c",
};

const DEFAULT_ZONE_COLOR = "#5b6b87";

export interface ZoneExtend {
  label: string;
  phase?: WyckoffPhase;
  note?: string;
}

export interface EventTagExtend {
  code: WyckoffEventCode;
  note?: string;
  /** 标签画在锚点上方还是下方。 */
  placement: "above" | "below";
}

const BIAS_COLORS: Record<WyckoffBias, string> = {
  bullish: "#f0475f",
  bearish: "#1fbf9c",
  neutral: "#e8a33d",
};

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 交易区间矩形。
 *
 * 内置的 rect 只是一个纯色方框，而 Wyckoff 的横盘箱体要同时表达三件事：区间范围、
 * 上下沿这两条关键的支撑阻力、以及所处阶段。所以这里自行拼一个：半透明填充画范围，
 * 上下沿描实线，左上角挂阶段标签并按阶段配色。
 */
const zoneTemplate: OverlayTemplate<ZoneExtend> = {
  name: ZONE_OVERLAY,
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, overlay }) => {
    if (coordinates.length < 2) return [];

    const [a, b] = coordinates as [Coordinate, Coordinate];
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x, b.x);
    const top = Math.min(a.y, b.y);
    const bottom = Math.max(a.y, b.y);
    const width = Math.max(right - left, 1);
    const height = Math.max(bottom - top, 1);

    const extend = overlay.extendData;
    const color = extend?.phase ? PHASE_COLORS[extend.phase] : DEFAULT_ZONE_COLOR;
    const caption = extend?.phase ? `${extend.label} · 阶段 ${extend.phase}` : (extend?.label ?? "交易区间");

    const figures: OverlayFigure[] = [
      {
        type: "rect",
        attrs: { x: left, y: top, width, height },
        styles: {
          style: "stroke_fill",
          color: withAlpha(color, 0.1),
          borderColor: withAlpha(color, 0.5),
          borderSize: 1,
          borderStyle: "dashed",
          borderDashedValue: [4, 4],
        },
      },
      // 上下沿单独描实线：支撑与阻力比区间的左右边界重要得多。
      {
        type: "line",
        attrs: { coordinates: [{ x: left, y: top }, { x: right, y: top }] },
        styles: { style: "solid", color: withAlpha(color, 0.9), size: 1.5 },
      },
      {
        type: "line",
        attrs: { coordinates: [{ x: left, y: bottom }, { x: right, y: bottom }] },
        styles: { style: "solid", color: withAlpha(color, 0.9), size: 1.5 },
      },
      {
        type: "text",
        attrs: { x: left + 4, y: top + 4, text: caption, align: "left", baseline: "top" },
        styles: {
          style: "fill",
          color: "#ffffff",
          size: 11,
          weight: 500,
          paddingLeft: 5,
          paddingRight: 5,
          paddingTop: 3,
          paddingBottom: 3,
          borderRadius: 3,
          backgroundColor: withAlpha(color, 0.85),
        },
      },
    ];

    return figures;
  },
};

/**
 * 事件标记：一个带 SC / Spring / UTAD 等代号的锚点标签。
 *
 * 内置的 simpleAnnotation 只能画固定符号加文字，无法按多空倾向配色、
 * 也不能把标签放到 K 线下方，而吸筹事件标在低点下方、派发事件标在高点上方
 * 是 Wyckoff 图上的惯例，所以单独做一个。
 */
const eventTagTemplate: OverlayTemplate<EventTagExtend> = {
  name: EVENT_TAG_OVERLAY,
  totalStep: 2,
  needDefaultPointFigure: false,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ coordinates, overlay }) => {
    if (coordinates.length < 1) return [];

    const point = coordinates[0];
    const extend = overlay.extendData;
    const code = extend?.code ?? "ST";
    const meta = WYCKOFF_EVENTS[code];
    const color = BIAS_COLORS[meta?.bias ?? "neutral"];
    const below = extend?.placement === "below";

    const leaderLength = 18;
    const tipY = below ? point.y + leaderLength : point.y - leaderLength;

    return [
      // 引线：把标签和它锚定的那根 K 线连起来，密集标注时不至于认错归属
      {
        type: "line",
        attrs: { coordinates: [{ x: point.x, y: point.y }, { x: point.x, y: tipY }] },
        styles: { style: "solid", color: withAlpha(color, 0.7), size: 1 },
      },
      {
        type: "circle",
        attrs: { x: point.x, y: point.y, r: 2.5 },
        styles: { style: "fill", color },
      },
      {
        type: "text",
        attrs: {
          x: point.x,
          y: tipY,
          text: code,
          align: "center",
          baseline: below ? "top" : "bottom",
        },
        styles: {
          style: "fill",
          color: "#ffffff",
          size: 11,
          weight: 600,
          paddingLeft: 5,
          paddingRight: 5,
          paddingTop: 2,
          paddingBottom: 2,
          borderRadius: 3,
          backgroundColor: color,
        },
      },
    ];
  },
};

let registered = false;

/** 注册领域自定义覆盖物。模块级只需执行一次。 */
export function registerWyckoffOverlays(): void {
  if (registered) return;
  registerOverlay<ZoneExtend>(zoneTemplate);
  registerOverlay<EventTagExtend>(eventTagTemplate);
  registered = true;
}

export { PHASE_COLORS, BIAS_COLORS };
