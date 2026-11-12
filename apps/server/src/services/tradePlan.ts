import type { AdjustType, AgentTradePlan, Period } from "@wyckoff/shared";
import { getState, setState } from "../db/index.js";

const KEY_PREFIX = "agent.tradePlan";

export function tradePlanKey(symbol: string, period: Period, adjust: AdjustType): string {
  return `${KEY_PREFIX}:${symbol}:${period}:${adjust}`;
}

export function getAgentTradePlan(
  symbol: string,
  period: Period,
  adjust: AdjustType,
): AgentTradePlan | null {
  try {
    const raw = getState(tradePlanKey(symbol, period, adjust));
    if (!raw) return null;
    return JSON.parse(raw) as AgentTradePlan;
  } catch {
    return null;
  }
}

export function saveAgentTradePlan(
  symbol: string,
  period: Period,
  adjust: AdjustType,
  plan: Omit<AgentTradePlan, "symbol" | "period" | "adjust" | "generatedAt" | "source">,
): AgentTradePlan {
  const value: AgentTradePlan = {
    ...plan,
    symbol,
    period,
    adjust,
    generatedAt: new Date().toISOString(),
    source: "agent",
  };
  setState(tradePlanKey(symbol, period, adjust), JSON.stringify(value));
  return value;
}
