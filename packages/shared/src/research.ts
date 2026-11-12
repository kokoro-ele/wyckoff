export type ResearchBias = "long" | "wait" | "short";
export type ResearchTrend = "up" | "down" | "flat";
export type ResearchLevelKind = "range" | "swing" | "ma";

export interface ResearchLevel {
  price: number;
  kind: ResearchLevelKind;
  timestamp?: number;
}

export interface ResearchQuote {
  price: number;
  prevClose: number | null;
  changePct: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  asOf: number;
  source: "tickflow";
}

export interface ResearchFundamentals {
  /** Human-readable provenance, e.g. "Tencent quote · SEC EDGAR". */
  source: string;
  currency: string | null;
  companyName: string | null;
  marketCap: number | null;
  pe: number | null;
  pb: number | null;
  eps: number | null;
  dividendYieldPct: number | null;
  week52High: number | null;
  week52Low: number | null;
  revenue: number | null;
  netIncome: number | null;
  grossMarginPct: number | null;
  netMarginPct: number | null;
  roePct: number | null;
  fiscalYear: string | null;
  updatedAt: string | null;
}

export type ResearchTriggerKind = "breakout" | "breakdown" | "hold" | "reclaim";

export interface ResearchStrategy {
  bias: ResearchBias;
  trigger: {
    kind: ResearchTriggerKind;
    price: number | null;
    ma?: "ma20" | "ma50";
  };
  entryLow: number | null;
  entryHigh: number | null;
  stop: number | null;
  target1: number | null;
  target2: number | null;
  riskReward: number | null;
  invalidation: {
    kind: "closeBelow" | "closeAbove";
    price: number | null;
  };
  support: ResearchLevel[];
  resistance: ResearchLevel[];
  trend: {
    short: ResearchTrend;
    medium: ResearchTrend;
    long: ResearchTrend;
    ma20: number | null;
    ma50: number | null;
    ma200: number | null;
  };
  atr: number | null;
  range: {
    support: number;
    resistance: number;
    startTime: number;
    endTime: number;
    hypothesis: string;
  } | null;
}

export interface ResearchResponse {
  symbol: string;
  name: string | null;
  exchange: string;
  region: string;
  currency: string;
  quote: ResearchQuote;
  fundamentals: ResearchFundamentals;
  strategy: ResearchStrategy;
  generatedAt: string;
}

/**
 * A trade plan produced by the Agent's structured tool call.
 * The server stores it inside the encrypted user workspace.
 */
export interface AgentTradePlan {
  symbol: string;
  period: string;
  adjust: string;
  bias: "long" | "wait" | "short";
  trigger: string;
  /** Structured trigger used for deterministic next-session status. */
  triggerCondition?: { direction: "above" | "below"; price: number } | null;
  invalidationCondition?: { direction: "above" | "below"; price: number } | null;
  entryLow: number | null;
  entryHigh: number | null;
  stop: number | null;
  target1: number | null;
  target2: number | null;
  riskReward: number | null;
  invalidation: string;
  support: number[];
  resistance: number[];
  note: string;
  generatedAt: string;
  source: "agent";
}
