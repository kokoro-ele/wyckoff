import type { Pool } from "pg";
import { withAccountLock } from "../billing/store.js";
import { addCredits } from "./store.js";

export const FEEDBACK_CREDITS = 3;

export interface FeedbackStatus {
  canPrompt: boolean;
  hasFeedback: boolean;
  analyses: number;
}

export async function feedbackStatus(pool: Pool, userId: string): Promise<FeedbackStatus> {
  const [feedback, usage] = await Promise.all([
    pool.query("SELECT 1 FROM feedback_responses WHERE user_id=$1", [userId]),
    pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM credit_usage WHERE user_id=$1 AND state='consumed'",
      [userId],
    ),
  ]);
  const analyses = usage.rows[0]?.count ?? 0;
  return {
    // Only ask a new user after their first successful platform analysis.
    canPrompt: !feedback.rowCount && analyses === 1,
    hasFeedback: Boolean(feedback.rowCount),
    analyses,
  };
}

export async function submitFeedback(
  pool: Pool,
  userId: string,
  rating: number,
  comment: string,
) {
  return withAccountLock(pool, userId, async (db) => {
    const prior = await db.query("SELECT 1 FROM feedback_responses WHERE user_id=$1", [userId]);
    if (prior.rowCount) {
      const balance = (
        await db.query<{ balance: number }>("SELECT balance FROM credit_accounts WHERE user_id=$1", [userId])
      ).rows[0]?.balance ?? 0;
      return { granted: false, already: true, credits: 0, balance };
    }
    await db.query(
      "INSERT INTO feedback_responses(user_id,rating,comment,credits_granted) VALUES($1,$2,$3,$4)",
      [userId, rating, comment.slice(0, 2000), FEEDBACK_CREDITS],
    );
    await addCredits(db, userId, FEEDBACK_CREDITS, `feedback:${userId}`);
    const balance = (
      await db.query<{ balance: number }>("SELECT balance FROM credit_accounts WHERE user_id=$1", [userId])
    ).rows[0]?.balance ?? 0;
    return { granted: true, already: false, credits: FEEDBACK_CREDITS, balance };
  });
}
