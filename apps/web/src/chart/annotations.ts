import {
  type StoredAnnotation,
  WYCKOFF_EVENTS,
  type WyckoffAnnotation,
  type WyckoffEventCode,
} from "@wyckoff/shared";
import type { Chart, Overlay, OverlayCreate } from "klinecharts";
import { BIAS_COLORS, EVENT_TAG_OVERLAY, ZONE_OVERLAY } from "./overlays.js";

const LEVEL_COLOR = "#e8a33d";
const TRENDLINE_COLOR = "#4d8dff";

/** 手绘覆盖物统一挂在这个分组下，与 Agent 产出的分组分开管理。 */
export const USER_GROUP_ID = "user-drawing";

/**
 * 语义标注 → KLineChart 覆盖物。
 *
 * 覆盖物的 id 直接复用标注 id、groupId 复用标注分组，这样整组显隐、整组删除、
 * 以及从图上反查回标注，都只是一次 `removeOverlay({ groupId })` 或 id 查表的事。
 */
export function annotationToOverlay(annotation: StoredAnnotation): OverlayCreate {
  const base = { id: annotation.id, groupId: annotation.groupId, lock: annotation.source === "agent" };

  switch (annotation.kind) {
    case "event": {
      const meta = WYCKOFF_EVENTS[annotation.code];
      // 看涨事件标的是低点，把标签放在 K 线下方；看跌事件反之。这是 Wyckoff 图上的惯例。
      const placement = meta?.bias === "bullish" ? "below" : "above";
      return {
        ...base,
        name: EVENT_TAG_OVERLAY,
        points: [{ timestamp: annotation.timestamp, value: annotation.price }],
        extendData: { code: annotation.code, note: annotation.note, placement },
      };
    }

    case "zone":
      return {
        ...base,
        name: ZONE_OVERLAY,
        points: [
          { timestamp: annotation.startTime, value: annotation.high },
          { timestamp: annotation.endTime, value: annotation.low },
        ],
        extendData: { label: annotation.label, phase: annotation.phase, note: annotation.note },
      };

    case "level": {
      const bounded = annotation.startTime !== undefined && annotation.endTime !== undefined;
      return {
        ...base,
        name: bounded ? "horizontalSegment" : "horizontalStraightLine",
        points: bounded
          ? [
              { timestamp: annotation.startTime, value: annotation.price },
              { timestamp: annotation.endTime, value: annotation.price },
            ]
          : [{ value: annotation.price }],
        extendData: { label: annotation.label, note: annotation.note },
        styles: { line: { color: LEVEL_COLOR, size: 1, style: "dashed", dashedValue: [5, 4] } },
      };
    }

    case "trendline":
      return {
        ...base,
        name: annotation.extend ? "rayLine" : "segment",
        points: annotation.points.map((p) => ({ timestamp: p.timestamp, value: p.price })),
        extendData: { label: annotation.label, note: annotation.note },
        styles: { line: { color: TRENDLINE_COLOR, size: 1.5, style: "solid" } },
      };
  }
}

/**
 * KLineChart 覆盖物 → 语义标注，用于把用户手绘的图形落库。
 * 斐波那契、平行通道这类协议里没有对应语义的图形返回 null，仅作为临时绘制存在。
 */
export function overlayToAnnotation(overlay: Overlay): WyckoffAnnotation | null {
  const points = overlay.points.filter((p) => p.timestamp !== undefined && p.value !== undefined) as {
    timestamp: number;
    value: number;
  }[];
  const label = (overlay.extendData as { label?: string } | undefined)?.label;

  switch (overlay.name) {
    case "horizontalStraightLine":
    case "horizontalRayLine":
    case "priceLine": {
      const value = overlay.points[0]?.value;
      if (value === undefined) return null;
      return { kind: "level", id: overlay.id, label: label ?? "水平线", price: value };
    }

    case "horizontalSegment": {
      if (points.length < 2) return null;
      return {
        kind: "level",
        id: overlay.id,
        label: label ?? "水平线",
        price: points[0].value,
        startTime: Math.min(points[0].timestamp, points[1].timestamp),
        endTime: Math.max(points[0].timestamp, points[1].timestamp),
      };
    }

    case "segment":
    case "straightLine":
    case "rayLine": {
      if (points.length < 2) return null;
      return {
        kind: "trendline",
        id: overlay.id,
        label: label ?? "趋势线",
        points: [
          { timestamp: points[0].timestamp, price: points[0].value },
          { timestamp: points[1].timestamp, price: points[1].value },
        ],
        extend: overlay.name === "rayLine",
      };
    }

    case ZONE_OVERLAY: {
      if (points.length < 2) return null;
      const extend = overlay.extendData as { label?: string; phase?: "A" | "B" | "C" | "D" | "E" } | undefined;
      return {
        kind: "zone",
        id: overlay.id,
        label: extend?.label ?? "交易区间",
        phase: extend?.phase,
        startTime: Math.min(points[0].timestamp, points[1].timestamp),
        endTime: Math.max(points[0].timestamp, points[1].timestamp),
        low: Math.min(points[0].value, points[1].value),
        high: Math.max(points[0].value, points[1].value),
      };
    }

    default:
      return null;
  }
}

/** 把一批标注同步到图上：先按 id 清掉旧的，再重新创建。 */
export function renderAnnotations(chart: Chart, annotations: StoredAnnotation[]): void {
  for (const annotation of annotations) {
    chart.removeOverlay({ id: annotation.id });
  }
  const creates = annotations.map(annotationToOverlay);
  if (creates.length > 0) chart.createOverlay(creates);
}

export function removeAnnotationGroup(chart: Chart, groupId: string): void {
  chart.removeOverlay({ groupId });
}

/** 事件标记的配色，供图例与标注列表复用。 */
export function eventColor(code: WyckoffEventCode): string {
  return BIAS_COLORS[WYCKOFF_EVENTS[code]?.bias ?? "neutral"];
}

export { LEVEL_COLOR, TRENDLINE_COLOR };
