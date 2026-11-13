import {
  makeId,
  type AgentMemoryEntry,
  type AgentMemoryKind,
  type AgentMemorySnapshot,
  type ResearchIntent,
} from "@wyckoff/shared";
import { db } from "../db/index.js";

export interface FocusInput {
  symbol: string;
  period: string;
  sessionId: string;
  question: string;
  intent: ResearchIntent;
  steps: string[];
}

export interface MemoryInput {
  symbol: string;
  period: string;
  sessionId?: string;
  content: string;
}

interface Row {
  id: string;
  symbol: string;
  period: string;
  session_id: string | null;
  kind: AgentMemoryKind;
  content: string;
  status: "open" | "resolved";
  created_at: number;
  updated_at: number;
}

const MAX_ROWS: Record<AgentMemoryKind, number> = {
  focus: 1,
  conclusion: 5,
  correction: 8,
  open: 6,
};

function trim(value: string, max = 2_000): string {
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function insert(
  kind: AgentMemoryKind,
  input: MemoryInput & { metadata?: Record<string, unknown>; status?: "open" | "resolved" },
): AgentMemoryEntry {
  const now = Date.now();
  const id = makeId("mem");
  db.prepare(
    `INSERT INTO agent_memory
      (id, symbol, period, session_id, kind, content, metadata, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.symbol,
    input.period,
    input.sessionId ?? null,
    kind,
    trim(input.content),
    input.metadata ? JSON.stringify(input.metadata) : null,
    input.status ?? "open",
    now,
    now,
  );
  prune(input.symbol, input.period, kind);
  return {
    id,
    symbol: input.symbol,
    period: input.period,
    sessionId: input.sessionId ?? null,
    kind,
    content: trim(input.content),
    status: input.status ?? "open",
    createdAt: now,
    updatedAt: now,
  };
}

function prune(symbol: string, period: string, kind: AgentMemoryKind): void {
  const max = MAX_ROWS[kind];
  db.prepare(
    `DELETE FROM agent_memory
     WHERE symbol = ? AND period = ? AND kind = ? AND id NOT IN (
       SELECT id FROM agent_memory
       WHERE symbol = ? AND period = ? AND kind = ?
       ORDER BY updated_at DESC, created_at DESC
       LIMIT ${max}
     )`,
  ).run(symbol, period, kind, symbol, period, kind);
}

function rowToEntry(row: Row): AgentMemoryEntry {
  return {
    id: row.id,
    symbol: row.symbol,
    period: row.period,
    sessionId: row.session_id,
    kind: row.kind,
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function list(symbol: string, period: string): AgentMemoryEntry[] {
  return db
    .prepare<[string, string], Row>(
      `SELECT id, symbol, period, session_id, kind, content, status, created_at, updated_at
       FROM agent_memory WHERE symbol = ? AND period = ?
       ORDER BY updated_at DESC, created_at DESC LIMIT 40`,
    )
    .all(symbol, period)
    .map(rowToEntry);
}

export function getSnapshot(symbol: string, period: string): AgentMemorySnapshot {
  const rows = list(symbol, period);
  return {
    focus: rows.find((row) => row.kind === "focus") ?? null,
    conclusions: rows.filter((row) => row.kind === "conclusion").slice(0, 4),
    corrections: rows.filter((row) => row.kind === "correction").slice(0, 6),
    open: rows.filter((row) => row.kind === "open" && row.status === "open").slice(0, 4),
  };
}

/** The latest focus wins; only one focus row is kept per symbol/period. */
export function rememberFocus(input: FocusInput): AgentMemoryEntry {
  db.prepare("DELETE FROM agent_memory WHERE symbol = ? AND period = ? AND kind = 'focus'").run(
    input.symbol,
    input.period,
  );
  return insert("focus", {
    symbol: input.symbol,
    period: input.period,
    sessionId: input.sessionId,
    content: input.question,
    metadata: { intent: input.intent, steps: input.steps },
  });
}

export function rememberConclusion(input: MemoryInput): AgentMemoryEntry {
  return insert("conclusion", { ...input, status: "resolved" });
}

export function rememberCorrection(input: MemoryInput): AgentMemoryEntry {
  const content = trim(input.content);
  const latest = db
    .prepare<[string, string], Row>(
      `SELECT id, symbol, period, session_id, kind, content, status, created_at, updated_at
       FROM agent_memory WHERE symbol = ? AND period = ? AND kind = 'correction'
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(input.symbol, input.period);
  if (latest?.content === content) return rowToEntry(latest);
  return insert("correction", { ...input, metadata: { source: "user" } });
}

export function rememberOpen(input: MemoryInput): AgentMemoryEntry {
  const content = trim(input.content);
  const latest = db
    .prepare<[string, string], Row>(
      `SELECT id, symbol, period, session_id, kind, content, status, created_at, updated_at
       FROM agent_memory WHERE symbol = ? AND period = ? AND kind = 'open' AND status = 'open'
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(input.symbol, input.period);
  if (latest?.content === content) return rowToEntry(latest);
  return insert("open", { ...input, metadata: { source: "interrupted" } });
}

/** A completed turn closes the outstanding question(s) for this symbol. */
export function resolveOpen(symbol: string, period: string): void {
  db.prepare(
    `UPDATE agent_memory SET status = 'resolved', updated_at = ?
     WHERE symbol = ? AND period = ? AND kind = 'open' AND status = 'open'`,
  ).run(Date.now(), symbol, period);
}

const CORRECTION_PATTERNS = [
  /不对/,
  /错了/,
  /弄错/,
  /纠正/,
  /应该是/,
  /不是.{0,12}而是/,
  /标错/,
  /日期.{0,8}(差|错|不对)/,
  /\bwrong\b/i,
  /\bcorrection\b/i,
  /\bnot\s+.+?\s+but\b/i,
  /\bactually\b/i,
];

export function looksLikeCorrection(message: string): boolean {
  return CORRECTION_PATTERNS.some((pattern) => pattern.test(message));
}

export function isResumeMessage(message: string): boolean {
  return /^(继续|接着|resume|continue)/i.test(message.trim());
}

export function formatMemoryPrompt(snapshot: AgentMemorySnapshot, language: "zh" | "en"): string {
  const lines: string[] = [];
  const add = (label: string, value: string) => lines.push(`- ${label}${value}`);
  if (snapshot.focus) add(language === "en" ? "Current research question: " : "当前研究问题：", snapshot.focus.content);
  if (snapshot.conclusions[0]) {
    add(language === "en" ? "Last conclusion: " : "上次分析结论：", snapshot.conclusions[0].content);
  }
  if (snapshot.corrections[0]) {
    add(language === "en" ? "Latest user correction: " : "用户最近的纠正：", snapshot.corrections[0].content);
  }
  for (const open of snapshot.open.slice(0, 3)) {
    add(language === "en" ? "Unfinished: " : "未完成：", open.content);
  }
  if (lines.length === 0) return "";
  return [
    language === "en" ? "# Cross-session research memory" : "# 跨会话研究记忆",
    ...lines,
    language === "en"
      ? "Use this memory when relevant. If the user is continuing, start from the unfinished question; if the user corrected you, the correction overrides the old conclusion. Do not repeat old work unnecessarily."
      : "相关时使用这些记忆。如果用户是在继续，先接着未完成的问题；如果用户纠正了你，以纠正为准，不要重复旧结论。不要机械重跑已经完成的工作。",
  ].join("\n");
}
