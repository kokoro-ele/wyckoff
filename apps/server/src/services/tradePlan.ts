import { makeId, type AdjustType, type AgentTradePlan, type Period } from "@wyckoff/shared";
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


export interface SavedStrategy {
  id: string;
  symbol: string;
  period: Period;
  adjust: AdjustType;
  plan: AgentTradePlan;
  savedAt: string;
}

const SAVED_KEY_PREFIX = "saved.strategies";

/** Explicit user snapshots, kept in the encrypted workspace alongside the live plan. */
export function saveStrategySnapshot(
  symbol: string,
  period: Period,
  adjust: AdjustType,
  plan: AgentTradePlan,
): SavedStrategy {
  const key = `${SAVED_KEY_PREFIX}:${symbol}:${period}:${adjust}`;
  const current = (() => {
    try {
      const parsed = JSON.parse(getState(key) ?? "[]") as SavedStrategy[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();
  const saved: SavedStrategy = {
    id: makeId("strategy"),
    symbol,
    period,
    adjust,
    plan,
    savedAt: new Date().toISOString(),
  };
  setState(key, JSON.stringify([saved, ...current].slice(0, 20)));
  return saved;
}

export function listStrategySnapshots(symbol: string, period: Period, adjust: AdjustType): SavedStrategy[] {
  const key = `${SAVED_KEY_PREFIX}:${symbol}:${period}:${adjust}`;
  try {
    const parsed = JSON.parse(getState(key) ?? "[]") as SavedStrategy[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
