import type { Period as AppPeriod, TimeSpanId } from "@wyckoff/shared";
import { TIME_SPANS } from "@wyckoff/shared";
import type { Period as ChartPeriod } from "klinecharts";

/** 把应用层周期映射成 KLineChart 的 { type, span }。 */
export function toChartPeriod(period: AppPeriod): ChartPeriod {
  switch (period) {
    case "1m":
      return { type: "minute", span: 1 };
    case "5m":
      return { type: "minute", span: 5 };
    case "15m":
      return { type: "minute", span: 15 };
    case "30m":
      return { type: "minute", span: 30 };
    case "60m":
      return { type: "hour", span: 1 };
    case "1d":
      return { type: "day", span: 1 };
    case "1w":
      return { type: "week", span: 1 };
    case "1M":
      return { type: "month", span: 1 };
    case "1Q":
      return { type: "month", span: 3 };
    case "1Y":
      return { type: "year", span: 1 };
  }
}

/** 按时间跨度估算首次加载需要的根数（留一点余量）。 */
export function barsForTimeSpan(span: TimeSpanId, period: AppPeriod): number {
  const days = TIME_SPANS.find((s) => s.id === span)?.days;
  if (days === null || days === undefined) return 5000;

  const perDay: Record<AppPeriod, number> = {
    "1m": 240,
    "5m": 48,
    "15m": 16,
    "30m": 8,
    "60m": 4,
    "1d": 1,
    "1w": 1 / 5,
    "1M": 1 / 22,
    "1Q": 1 / 66,
    "1Y": 1 / 250,
  };

  return Math.min(10_000, Math.max(80, Math.ceil(days * perDay[period] * 1.3)));
}

export function timeSpanDays(span: TimeSpanId): number | null {
  return TIME_SPANS.find((s) => s.id === span)?.days ?? null;
}
