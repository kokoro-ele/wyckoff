import {
  type AgentEvent,
  type AdjustType,
  annotationSchema,
  type Kline,
  makeId,
  type Period,
  WYCKOFF_EVENT_CODES,
  type WyckoffAnnotation,
} from "@wyckoff/shared";
import type { FunctionTool, Tool } from "openai/resources/responses/responses";
import { formatBarTime, nearestIndex, renderFeatureSummary } from "@wyckoff/wyckoff";
import { getInstrument } from "../services/instruments.js";
import { getFeatures } from "../services/market.js";
import * as annotationStore from "../services/annotations.js";

export interface RunContext {
  symbol: string;
  period: Period;
  adjust: AdjustType;
  /** 本轮对话内缓存的全量 K 线，供日期吸附与切片使用。 */
  klines(): Promise<Kline[]>;
}

export interface ToolResult {
  /** 回给模型的文本。 */
  content: string;
  /** 需要推给前端的客户端事件（画图、聚焦等）。 */
  events?: AgentEvent[];
  /** 展示在 UI 工具轨迹里的一句话。 */
  summary: string;
  ok?: boolean;
}

// ————————————————— 时间处理 —————————————————

/**
 * 把模型给出的日期吸附到真实存在的那根 K 线上。
 *
 * 让模型只写 `YYYY-MM-DD`、由服务端负责吸附，是这套工具最重要的一个约定：
 * 模型不必处理毫秒时间戳，也不会因为写了一个非交易日而让标注落空。
 */
function snapToBar(klines: Kline[], value: unknown): number | null {
  if (klines.length === 0) return null;

  let target: number | null = null;
  if (typeof value === "number" && Number.isFinite(value)) {
    target = value > 1e11 ? value : value * 1000;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) target = Date.parse(`${trimmed}T00:00:00Z`);
    else if (/^\d+$/.test(trimmed)) target = Number(trimmed);
    else {
      const parsed = Date.parse(trimmed);
      if (!Number.isNaN(parsed)) target = parsed;
    }
  }
  if (target === null || Number.isNaN(target)) return null;

  const index = nearestIndex(klines, target);
  return index >= 0 ? klines[index].timestamp : null;
}

// ————————————————— 工具的 JSON Schema —————————————————

const dateParam = {
  type: "string",
  description: "日期，格式 YYYY-MM-DD。会自动吸附到最接近的那根 K 线。",
} as const;

/**
 * 标注参数刻意做成「带 kind 判别字段的扁平对象」而不是 oneOf 联合。
 * 各家模型对 JSON Schema 的 oneOf 支持参差不齐，扁平结构生成成功率明显更高，
 * 字段合法性由服务端逐条校验并把错误原文回传给模型自行修正。
 */
const annotationItemSchema = {
  type: "object",
  required: ["kind"],
  properties: {
    kind: {
      type: "string",
      enum: ["event", "zone", "level", "trendline"],
      description: "event=事件标记，zone=矩形交易区间，level=水平线，trendline=趋势线",
    },
    code: {
      type: "string",
      enum: [...WYCKOFF_EVENT_CODES],
      description: "仅 kind=event 时必填，Wyckoff 事件代号",
    },
    date: { ...dateParam, description: "kind=event 或 level 时的锚定日期。event 必填。" },
    price: { type: "number", description: "kind=event 或 level 时的价格。event 通常取该 K 线的最高价或最低价。" },
    label: { type: "string", description: "kind=zone / level / trendline 的名称，用中文，例如「吸筹交易区间」「小溪(Creek)」" },
    phase: { type: "string", enum: ["A", "B", "C", "D", "E"], description: "仅 kind=zone，该区间对应的 Wyckoff 阶段" },
    start_date: { ...dateParam, description: "kind=zone 的起始日期（必填）；kind=level 的起始日期（可选）" },
    end_date: { ...dateParam, description: "kind=zone 的结束日期（必填）；kind=level 的结束日期（可选）" },
    low: { type: "number", description: "仅 kind=zone，区间下沿价格" },
    high: { type: "number", description: "仅 kind=zone，区间上沿价格" },
    from_date: { ...dateParam, description: "仅 kind=trendline，起点日期" },
    from_price: { type: "number", description: "仅 kind=trendline，起点价格" },
    to_date: { ...dateParam, description: "仅 kind=trendline，终点日期" },
    to_price: { type: "number", description: "仅 kind=trendline，终点价格" },
    extend: { type: "boolean", description: "仅 kind=trendline，是否向右延伸成射线" },
    note: { type: "string", description: "该标注的说明，会显示在图上的悬浮提示里。写清判读依据。" },
  },
  additionalProperties: false,
} as const;

export const toolDefinitions = [
  {
    type: "function" as const,
    function: {
      name: "get_features",
      description:
        "获取当前标的的 Wyckoff 结构摘要：横盘交易区间及其上下沿与边界穿刺、摆动高低点、量价异常 K 线、均线与相对强度。" +
        "这是分析的起点，回答任何涉及具体走势的问题前都应该先调用它。",
      parameters: {
        type: "object",
        properties: {
          start_date: { ...dateParam, description: "分析起始日期，留空表示全部历史" },
          end_date: { ...dateParam, description: "分析结束日期，留空表示到最新" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_klines",
      description: "获取逐根 K 线的开高低收与成交量。只在需要核对某一小段的具体数值时使用，一次不要超过 200 根。",
      parameters: {
        type: "object",
        properties: {
          start_date: dateParam,
          end_date: dateParam,
          max_bars: { type: "integer", description: "最多返回多少根，默认 120，上限 300", minimum: 1, maximum: 300 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "draw_annotations",
      description:
        "在用户的 K 线图上批量绘制 Wyckoff 标注。得出判读结论后必须调用它把结构画出来，" +
        "让文字讲解和图上标注一一对应。同一次分析的标注会归为一组，方便整组显隐或删除。",
      parameters: {
        type: "object",
        required: ["title", "annotations"],
        properties: {
          title: { type: "string", description: "这组标注的标题，例如「2024 年吸筹结构」" },
          annotations: { type: "array", items: annotationItemSchema, minItems: 1 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "clear_annotations",
      description: "清除图上的标注。传入 group_id 只清那一组，不传则清空当前标的下 Agent 画的全部标注（用户手绘的保留）。",
      parameters: {
        type: "object",
        properties: { group_id: { type: "string" } },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_annotation",
      description: "修改已有的单个标注。用户提出局部调整时用它，不要整组重画。",
      parameters: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "标注 id" },
          note: { type: "string" },
          label: { type: "string" },
          code: { type: "string", enum: [...WYCKOFF_EVENT_CODES] },
          phase: { type: "string", enum: ["A", "B", "C", "D", "E"] },
          price: { type: "number" },
          low: { type: "number" },
          high: { type: "number" },
          date: dateParam,
          start_date: dateParam,
          end_date: dateParam,
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "focus_range",
      description: "把用户的画布滚动并缩放到指定时间范围，用于把注意力引导到你正在讲解的那一段。",
      parameters: {
        type: "object",
        required: ["start_date", "end_date"],
        properties: { start_date: dateParam, end_date: dateParam },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_instrument_info",
      description: "查询标的的基础信息：名称、交易所、类型、上市日期、股本。",
      parameters: {
        type: "object",
        properties: { symbol: { type: "string", description: "标的代码，留空表示当前标的" } },
        additionalProperties: false,
      },
    },
  },
];

/** Responses API 工具列表：可选内置 web_search + 本地 function tools。 */
export function responseTools(includeWebSearch: boolean): Tool[] {
  const functions: FunctionTool[] = toolDefinitions.map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters as FunctionTool["parameters"],
    strict: false,
  }));

  if (!includeWebSearch) return functions;

  return [
    {
      type: "web_search",
      search_context_size: "medium",
      user_location: { country: "CN", timezone: "Asia/Shanghai", city: "Shanghai" },
    },
    ...functions,
  ];
}

// ————————————————— 执行器 —————————————————

type Args = Record<string, unknown>;

export async function executeTool(name: string, args: Args, ctx: RunContext): Promise<ToolResult> {
  switch (name) {
    case "get_features":
      return getFeaturesTool(args, ctx);
    case "get_klines":
      return getKlinesTool(args, ctx);
    case "draw_annotations":
      return drawAnnotationsTool(args, ctx);
    case "clear_annotations":
      return clearAnnotationsTool(args, ctx);
    case "update_annotation":
      return updateAnnotationTool(args, ctx);
    case "focus_range":
      return focusRangeTool(args, ctx);
    case "get_instrument_info":
      return instrumentInfoTool(args, ctx);
    default:
      return { content: `未知工具：${name}`, summary: `未知工具 ${name}`, ok: false };
  }
}

async function getFeaturesTool(args: Args, ctx: RunContext): Promise<ToolResult> {
  const started = Date.now();
  const klines = await ctx.klines();
  const startTime = args.start_date ? snapToBar(klines, args.start_date) ?? undefined : undefined;
  const endTime = args.end_date ? snapToBar(klines, args.end_date) ?? undefined : undefined;

  const features = await getFeatures({
    symbol: ctx.symbol,
    period: ctx.period,
    adjust: ctx.adjust,
    startTime,
    endTime,
  });
  const featureMs = Date.now() - started;

  return {
    content: renderFeatureSummary(features),
    summary: `读取 ${ctx.symbol} 结构特征：${features.barCount} 根 K 线，识别出 ${features.tradingRanges.length} 个横盘区间 · ${featureMs}ms`,
  };
}

async function getKlinesTool(args: Args, ctx: RunContext): Promise<ToolResult> {
  const all = await ctx.klines();
  const startTime = args.start_date ? snapToBar(all, args.start_date) : null;
  const endTime = args.end_date ? snapToBar(all, args.end_date) : null;
  const maxBars = Math.min(Number(args.max_bars) || 120, 300);

  let slice = all;
  if (startTime !== null) slice = slice.filter((b) => b.timestamp >= startTime);
  if (endTime !== null) slice = slice.filter((b) => b.timestamp <= endTime);

  const truncated = slice.length > maxBars;
  if (truncated) slice = slice.slice(-maxBars);

  if (slice.length === 0) {
    return { content: "所选范围内没有 K 线数据。", summary: "所选范围无数据", ok: false };
  }

  const rows = slice
    .map(
      (b) =>
        `${formatBarTime(b.timestamp, ctx.period)} O${round(b.open)} H${round(b.high)} L${round(b.low)} C${round(b.close)} V${Math.round(b.volume)}`,
    )
    .join("\n");

  return {
    content:
      (truncated ? `范围内 K 线过多，仅返回最近 ${maxBars} 根：\n` : "") +
      `日期 开高低收 成交量\n${rows}`,
    summary: `读取 ${slice.length} 根 K 线明细`,
  };
}

interface NormalizeResult {
  annotations: WyckoffAnnotation[];
  errors: string[];
}

/** 把模型输出的扁平标注对象转成协议里的判别联合，逐条校验并收集错误。 */
function normalizeAnnotations(raw: unknown, klines: Kline[]): NormalizeResult {
  const items = Array.isArray(raw) ? raw : [];
  const annotations: WyckoffAnnotation[] = [];
  const errors: string[] = [];

  items.forEach((item, i) => {
    const a = (item ?? {}) as Args;
    const label = `第 ${i + 1} 条标注`;
    const note = typeof a.note === "string" ? a.note : undefined;

    let candidate: unknown;
    switch (a.kind) {
      case "event": {
        const timestamp = snapToBar(klines, a.date);
        if (timestamp === null) {
          errors.push(`${label}：event 缺少可解析的 date`);
          return;
        }
        candidate = { kind: "event", code: a.code, timestamp, price: a.price, note };
        break;
      }
      case "zone": {
        const startTime = snapToBar(klines, a.start_date);
        const endTime = snapToBar(klines, a.end_date);
        if (startTime === null || endTime === null) {
          errors.push(`${label}：zone 需要同时给出可解析的 start_date 与 end_date`);
          return;
        }
        candidate = {
          kind: "zone",
          label: a.label ?? "交易区间",
          phase: a.phase,
          startTime: Math.min(startTime, endTime),
          endTime: Math.max(startTime, endTime),
          low: typeof a.low === "number" && typeof a.high === "number" ? Math.min(a.low, a.high) : a.low,
          high: typeof a.low === "number" && typeof a.high === "number" ? Math.max(a.low, a.high) : a.high,
          note,
        };
        break;
      }
      case "level": {
        candidate = {
          kind: "level",
          label: a.label ?? "关键价位",
          price: a.price,
          startTime: a.start_date ? snapToBar(klines, a.start_date) ?? undefined : undefined,
          endTime: a.end_date ? snapToBar(klines, a.end_date) ?? undefined : undefined,
          note,
        };
        break;
      }
      case "trendline": {
        const fromTime = snapToBar(klines, a.from_date);
        const toTime = snapToBar(klines, a.to_date);
        if (fromTime === null || toTime === null) {
          errors.push(`${label}：trendline 需要同时给出可解析的 from_date 与 to_date`);
          return;
        }
        candidate = {
          kind: "trendline",
          label: a.label ?? "趋势线",
          points: [
            { timestamp: fromTime, price: a.from_price },
            { timestamp: toTime, price: a.to_price },
          ],
          extend: a.extend === true,
          note,
        };
        break;
      }
      default:
        errors.push(`${label}：kind 必须是 event / zone / level / trendline 之一`);
        return;
    }

    const parsed = annotationSchema.safeParse(candidate);
    if (parsed.success) annotations.push(parsed.data);
    else errors.push(`${label}：${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("；")}`);
  });

  return { annotations, errors };
}

async function drawAnnotationsTool(args: Args, ctx: RunContext): Promise<ToolResult> {
  const klines = await ctx.klines();
  const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : "Wyckoff 结构分析";
  const { annotations, errors } = normalizeAnnotations(args.annotations, klines);

  if (annotations.length === 0) {
    return {
      content: `没有一条标注通过校验，图上未做改动。请修正后重试：\n${errors.join("\n")}`,
      summary: "标注校验失败",
      ok: false,
    };
  }

  const groupId = makeId("grp");
  const saved = annotationStore.saveAnnotationGroup({
    groupId,
    symbol: ctx.symbol,
    period: ctx.period,
    title,
    annotations,
    source: "agent",
  });

  const counts = saved.reduce<Record<string, number>>((acc, a) => {
    acc[a.kind] = (acc[a.kind] ?? 0) + 1;
    return acc;
  }, {});
  const breakdown = Object.entries(counts)
    .map(([kind, n]) => `${n} 个${{ event: "事件", zone: "区间", level: "水平线", trendline: "趋势线" }[kind] ?? kind}`)
    .join("、");

  return {
    content:
      `已在图上绘制「${title}」，包含 ${breakdown}。分组 id 为 ${groupId}，各标注 id：` +
      saved.map((a) => `${a.kind}:${a.id}`).join(", ") +
      (errors.length > 0 ? `\n以下标注被跳过：\n${errors.join("\n")}` : ""),
    summary: `绘制「${title}」：${breakdown}`,
    events: [{ type: "annotations", groupId, title, annotations: saved }],
  };
}

async function clearAnnotationsTool(args: Args, ctx: RunContext): Promise<ToolResult> {
  const groupId = typeof args.group_id === "string" ? args.group_id : undefined;
  if (groupId) {
    annotationStore.deleteAnnotationGroup(groupId);
    return {
      content: `已清除标注分组 ${groupId}。`,
      summary: "清除一组标注",
      events: [{ type: "annotations_cleared", groupId }],
    };
  }
  annotationStore.clearAnnotations(ctx.symbol, ctx.period, "agent");
  return {
    content: "已清除该标的下由你绘制的全部标注，用户手绘的标注保留。",
    summary: "清空 Agent 标注",
    events: [{ type: "annotations_cleared" }],
  };
}

async function updateAnnotationTool(args: Args, ctx: RunContext): Promise<ToolResult> {
  const id = typeof args.id === "string" ? args.id : "";
  if (!id) return { content: "缺少标注 id。", summary: "缺少标注 id", ok: false };

  const klines = await ctx.klines();
  const patch: Args = {};
  for (const key of ["note", "label", "code", "phase", "price", "low", "high"]) {
    if (args[key] !== undefined) patch[key] = args[key];
  }
  if (args.date !== undefined) patch.timestamp = snapToBar(klines, args.date);
  if (args.start_date !== undefined) patch.startTime = snapToBar(klines, args.start_date);
  if (args.end_date !== undefined) patch.endTime = snapToBar(klines, args.end_date);

  const updated = annotationStore.updateAnnotation(id, patch);
  if (!updated) return { content: `找不到 id 为 ${id} 的标注。`, summary: "标注不存在", ok: false };

  const bundle = annotationStore.listAnnotations(ctx.symbol, ctx.period);
  const group = bundle.groups.find((g) => g.groupId === updated.groupId);

  return {
    content: `已更新标注 ${id}。`,
    summary: `更新标注 ${id}`,
    // 复用整组下发的通道刷新画布，避免前端再维护一套单条更新的逻辑。
    events: [
      {
        type: "annotations",
        groupId: updated.groupId,
        title: group?.title ?? "已更新",
        annotations: bundle.annotations.filter((a) => a.groupId === updated.groupId),
      },
    ],
  };
}

async function focusRangeTool(args: Args, ctx: RunContext): Promise<ToolResult> {
  const klines = await ctx.klines();
  const startTime = snapToBar(klines, args.start_date);
  const endTime = snapToBar(klines, args.end_date);
  if (startTime === null || endTime === null) {
    return { content: "日期无法解析，画布未做调整。", summary: "聚焦失败", ok: false };
  }
  const [from, to] = startTime <= endTime ? [startTime, endTime] : [endTime, startTime];
  return {
    content: `画布已聚焦到 ${formatBarTime(from, ctx.period)} ~ ${formatBarTime(to, ctx.period)}。`,
    summary: `聚焦 ${formatBarTime(from, ctx.period)} ~ ${formatBarTime(to, ctx.period)}`,
    events: [{ type: "focus_range", startTime: from, endTime: to }],
  };
}

async function instrumentInfoTool(args: Args, ctx: RunContext): Promise<ToolResult> {
  const symbol = typeof args.symbol === "string" && args.symbol ? args.symbol : ctx.symbol;
  const info = await getInstrument(symbol);
  if (!info) return { content: `未找到标的 ${symbol}。`, summary: `未找到 ${symbol}`, ok: false };

  const parts = [
    `${info.symbol} ${info.name ?? ""}`,
    `交易所 ${info.exchange}`,
    `地区 ${info.region}`,
    info.type ? `类型 ${info.type}` : "",
    info.listingDate ? `上市 ${info.listingDate}` : "",
    info.totalShares ? `总股本 ${(info.totalShares / 1e8).toFixed(2)} 亿股` : "",
    info.floatShares ? `流通股本 ${(info.floatShares / 1e8).toFixed(2)} 亿股` : "",
  ].filter(Boolean);

  return { content: parts.join("，"), summary: `查询 ${symbol} 基础信息` };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
