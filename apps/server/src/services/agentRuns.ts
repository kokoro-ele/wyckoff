import { getPool } from "../cloud/postgres.js";

/** Marks a streaming run as stopped. The model loop checks this before it saves or charges. */
export async function cancelAgentRun(userId: string, runId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    "INSERT INTO agent_run_cancels (run_id, user_id) VALUES ($1, $2) ON CONFLICT (run_id) DO NOTHING",
    [runId, userId],
  );
  await pool.query("DELETE FROM agent_run_cancels WHERE created_at < now() - interval '1 day'");
}

export async function isAgentRunCancelled(runId: string | undefined): Promise<boolean> {
  if (!runId) return false;
  const result = await getPool().query("SELECT 1 FROM agent_run_cancels WHERE run_id = $1", [runId]);
  return (result.rowCount ?? 0) > 0;
}
