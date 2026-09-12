import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** 按量级选择小数位，避免复权价拖着一长串浮点尾巴。 */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 3 : 4;
  return value.toFixed(digits);
}

export function formatVolume(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(2)}亿`;
  if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(2)}万`;
  return String(Math.round(value));
}

export function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/** 日线及以上的时间戳落在 UTC 零点，用 UTC 取日期才是正确的交易日。 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function formatDateTime(timestamp: number, intraday: boolean): string {
  const iso = new Date(timestamp).toISOString();
  return intraday ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

export function isIntradayPeriod(period: string): boolean {
  return period.endsWith("m") && period !== "1M";
}

export function classifyChange(value: number): string {
  if (value > 0) return "text-up";
  if (value < 0) return "text-down";
  return "text-ink-dim";
}

/** 耗时展示：毫秒 / 秒 / 分秒。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}
