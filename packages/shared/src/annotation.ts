import { z } from "zod";
import { WYCKOFF_EVENT_CODES } from "./wyckoff-events.js";

/**
 * 语义标注协议。
 *
 * Agent 只输出「领域语义」（哪根 K 线是 SC、哪段区间是 Phase B），
 * 绝不输出像素坐标。前端渲染层负责把它翻译成 KLineChart 的 overlay。
 * 这样 LLM 的输出可以被 zod 严格校验、可持久化、可被用户手动编辑，
 * 后续对话也能引用同一批标注做增量修改。
 */

export const wyckoffEventCodeSchema = z.enum(WYCKOFF_EVENT_CODES);
export const wyckoffPhaseSchema = z.enum(["A", "B", "C", "D", "E"]);

const pointSchema = z.object({
  timestamp: z.number().int().describe("K 线的毫秒时间戳"),
  price: z.number().describe("价格"),
});

export type AnnotationPoint = z.infer<typeof pointSchema>;

const baseFields = {
  /** 标注唯一 id。Agent 可不传，由服务端补齐。 */
  id: z.string().optional(),
  /** 分组 id，用于批量显隐与删除。同一次分析产出的标注共享一个 groupId。 */
  groupId: z.string().optional(),
  /** 补充说明，会显示在标注的悬浮提示里。 */
  note: z.string().optional(),
};

export const eventAnnotationSchema = z.object({
  ...baseFields,
  kind: z.literal("event"),
  code: wyckoffEventCodeSchema.describe("Wyckoff 事件代号，如 SC / Spring / UTAD"),
  timestamp: z.number().int().describe("事件所在 K 线的毫秒时间戳"),
  price: z.number().describe("标注锚定的价格，通常取该 K 线的最高价或最低价"),
});

export const zoneAnnotationSchema = z.object({
  ...baseFields,
  kind: z.literal("zone"),
  label: z.string().describe("区间名称，如「吸筹交易区间」"),
  phase: wyckoffPhaseSchema.optional().describe("该区间对应的 Wyckoff 阶段"),
  startTime: z.number().int(),
  endTime: z.number().int(),
  low: z.number().describe("区间下沿价格"),
  high: z.number().describe("区间上沿价格"),
});

export const levelAnnotationSchema = z.object({
  ...baseFields,
  kind: z.literal("level"),
  label: z.string().describe("水平线名称，如「区间阻力」「Spring 低点」"),
  price: z.number(),
  /** 省略时间范围则画成贯穿全图的水平线。 */
  startTime: z.number().int().optional(),
  endTime: z.number().int().optional(),
});

export const trendlineAnnotationSchema = z.object({
  ...baseFields,
  kind: z.literal("trendline"),
  label: z.string().describe("趋势线名称，如「小溪(Creek)」「冰面(Ice)」「供给线」「需求线」"),
  points: z.tuple([pointSchema, pointSchema]),
  /** 是否向右延伸成射线。 */
  extend: z.boolean().optional(),
});

export const annotationSchema = z.discriminatedUnion("kind", [
  eventAnnotationSchema,
  zoneAnnotationSchema,
  levelAnnotationSchema,
  trendlineAnnotationSchema,
]);

export type EventAnnotation = z.infer<typeof eventAnnotationSchema>;
export type ZoneAnnotation = z.infer<typeof zoneAnnotationSchema>;
export type LevelAnnotation = z.infer<typeof levelAnnotationSchema>;
export type TrendlineAnnotation = z.infer<typeof trendlineAnnotationSchema>;
export type WyckoffAnnotation = z.infer<typeof annotationSchema>;
export type AnnotationKind = WyckoffAnnotation["kind"];

/** 落库后的标注，id 与 groupId 一定存在。 */
export type StoredAnnotation = WyckoffAnnotation & {
  id: string;
  groupId: string;
  source: "agent" | "user";
};

export interface AnnotationGroup {
  groupId: string;
  symbol: string;
  period: string;
  title: string;
  createdAt: number;
  visible: boolean;
}

export const ANNOTATION_KIND_LABELS: Record<AnnotationKind, string> = {
  event: "事件",
  zone: "区间",
  level: "水平线",
  trendline: "趋势线",
};

/** 生成一个短随机 id，服务端与前端共用。 */
export function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
