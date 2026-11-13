import type { AgentMemoryEntry } from "@wyckoff/shared";
import { getPool } from "../cloud/postgres.js";

export interface RunCancelInput {
  userId: string;
  runId: string;
  symbol?: string;
  period?: string;
  sessionId?: string;
  question?: string;
}

/** Marks a streaming run as stopped and stores enough context to resume it. */
export async function cancelAgentRun(input: RunCancelInput): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO agent_run_cancels (run_id, user_id, symbol, period, session_id, question)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (run_id) DO UPDATE SET
       symbol = COALESCE(EXCLUDED.symbol, agent_run_cancels.symbol),
       period = COALESCE(EXCLUDED.period, agent_run_cancels.period),
       session_id = COALESCE(EXCLUDED.session_id, agent_run_cancels.session_id),
       question = COALESCE(EXCLUDED.question, agent_run_cancels.question)`,
    [
      input.runId,
      input.userId,
      input.symbol ?? null,
      input.period ?? null,
      input.sessionId ?? null,
      input.question ?? null,
    ],
  );
  await pool.query("DELETE FROM agent_run_cancels WHERE created_at < now() - interval '1 day'");
}

export async function isAgentRunCancelled(runId: string | undefined): Promise<boolean> {
  if (!runId) return false;
  const result = await getPool().query("SELECT 1 FROM agent_run_cancels WHERE run_id = $1", [runId]);
  return (result.rowCount ?? 0) > 0;
}

export async function listInterruptedRuns(
  userId: string,
  symbol: string,
  period: string,
): Promise<AgentMemoryEntry[]> {
  const result = await getPool().query<{
    run_id: string;
    session_id: string | null;
    question: string;
    created_at: Date;
  }>(
    `SELECT run_id, session_id, question, created_at
     FROM agent_run_cancels
     WHERE user_id = $1 AND symbol = $2 AND period = $3 AND question IS NOT NULL
       AND created_at > now() - interval '1 day'
     ORDER BY created_at DESC LIMIT 4`,
    [userId, symbol, period],
  );
  return result.rows.map((row) => ({
    id: `cancel_${row.run_id}`,
    symbol,
    period,
    sessionId: row.session_id,
    kind: "open",
    content: row.question,
    status: "open",
    createdAt: row.created_at.getTime(),
    updatedAt: row.created_at.getTime(),
  }));
}

/** Clear stop markers after a successful turn, or when the user explicitly resumes. */
export async function clearInterruptedRuns(userId: string, symbol: string, period: string): Promise<void> {
  await getPool().query(
    "DELETE FROM agent_run_cancels WHERE user_id = $1 AND symbol = $2 AND period = $3",
    [userId, symbol, period],
  );
}
