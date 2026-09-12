import type { ChatContext, ChatMessage } from "@wyckoff/shared";
import { db } from "../db/index.js";

export interface SessionRow {
  id: string;
  symbol: string;
  period: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export function ensureSession(id: string, symbol: string, period: string, title = "未命名分析"): void {
  const now = Date.now();
  db.prepare(`
    INSERT INTO sessions (id, symbol, period, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET symbol = excluded.symbol, period = excluded.period, updated_at = excluded.updated_at
  `).run(id, symbol, period, title, now, now);
}

export function listSessions(symbol?: string): SessionRow[] {
  const sql = `
    SELECT id, symbol, period, title, created_at AS createdAt, updated_at AS updatedAt
    FROM sessions${symbol ? " WHERE symbol = ?" : ""}
    ORDER BY updated_at DESC LIMIT 50
  `;
  return symbol
    ? db.prepare<[string], SessionRow>(sql).all(symbol)
    : db.prepare<[], SessionRow>(sql).all();
}

export function getMessages(sessionId: string): ChatMessage[] {
  return db
    .prepare<[string], { id: string; role: string; content: string; tool_trace: string | null; context: string | null; created_at: number }>(
      "SELECT id, role, content, tool_trace, context, created_at FROM messages WHERE session_id = ? ORDER BY created_at, rowid",
    )
    .all(sessionId)
    .map((row) => ({
      id: row.id,
      role: row.role as ChatMessage["role"],
      content: row.content,
      toolTrace: row.tool_trace ? (JSON.parse(row.tool_trace) as ChatMessage["toolTrace"]) : undefined,
      context: row.context ? (JSON.parse(row.context) as ChatContext) : undefined,
      createdAt: row.created_at,
    }));
}

export function appendMessage(sessionId: string, message: ChatMessage): void {
  db.prepare(`
    INSERT INTO messages (id, session_id, role, content, tool_trace, context, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET content = excluded.content, tool_trace = excluded.tool_trace
  `).run(
    message.id,
    sessionId,
    message.role,
    message.content,
    message.toolTrace ? JSON.stringify(message.toolTrace) : null,
    message.context ? JSON.stringify(message.context) : null,
    message.createdAt,
  );
  db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(Date.now(), sessionId);
}

/** 用首条用户消息作为会话标题，避免侧栏里全是「未命名分析」。 */
export function titleFromFirstMessage(sessionId: string, text: string): void {
  const row = db.prepare<[string], { title: string }>("SELECT title FROM sessions WHERE id = ?").get(sessionId);
  if (!row || row.title !== "未命名分析") return;
  const title = text.trim().slice(0, 24) || "未命名分析";
  db.prepare("UPDATE sessions SET title = ? WHERE id = ?").run(title, sessionId);
}

export function deleteSession(id: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}
