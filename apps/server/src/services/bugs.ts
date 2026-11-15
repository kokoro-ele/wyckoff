import { makeId } from "@wyckoff/shared";
import type { Pool } from "pg";
import { withAccountLock } from "../billing/store.js";
import { addCredits } from "../credits/store.js";

export const BUG_REWARD_CREDITS = 10;

export interface BugReport {
  id: string;
  user_id: string;
  email?: string;
  title: string;
  body: string;
  page_url: string;
  status: "pending" | "confirmed" | "rejected";
  credits_granted: number;
  created_at: Date;
  confirmed_at: Date | null;
}

export async function createBugReport(
  pool: Pool,
  userId: string,
  input: { title: string; body: string; pageUrl: string },
) {
  const report: BugReport = {
    id: makeId("bug"),
    user_id: userId,
    title: input.title.trim().slice(0, 160),
    body: input.body.trim().slice(0, 4000),
    page_url: input.pageUrl.slice(0, 500),
    status: "pending",
    credits_granted: 0,
    created_at: new Date(),
    confirmed_at: null,
  };
  await pool.query(
    `INSERT INTO bug_reports(id,user_id,title,body,page_url,status) VALUES($1,$2,$3,$4,$5,'pending')`,
    [report.id, report.user_id, report.title, report.body, report.page_url],
  );
  return report;
}

export async function listMyBugReports(pool: Pool, userId: string) {
  const { rows } = await pool.query<BugReport>(
    `SELECT id,user_id,title,body,page_url,status,credits_granted,created_at,confirmed_at
     FROM bug_reports WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`,
    [userId],
  );
  return rows;
}

export async function listBugReports(pool: Pool) {
  const { rows } = await pool.query<BugReport>(
    `SELECT b.id,b.user_id,u.email,b.title,b.body,b.page_url,b.status,b.credits_granted,b.created_at,b.confirmed_at
     FROM bug_reports b JOIN "user" u ON u.id=b.user_id
     ORDER BY b.created_at DESC LIMIT 100`,
  );
  return rows;
}

export async function confirmBugReport(pool: Pool, id: string) {
  return withAccountLock(pool, `bug:${id}`, async (db) => {
    const report = (
      await db.query<BugReport>(
        `SELECT id,user_id,status,credits_granted FROM bug_reports WHERE id=$1 FOR UPDATE`,
        [id],
      )
    ).rows[0];
    if (!report) return { ok: false, reason: "not_found" as const };
    if (report.status === "confirmed") return { ok: true, already: true, credits: 0 };
    if (report.status === "rejected") return { ok: false, reason: "rejected" as const };
    await db.query(
      `UPDATE bug_reports SET status='confirmed',credits_granted=$2,confirmed_at=now() WHERE id=$1`,
      [id, BUG_REWARD_CREDITS],
    );
    await addCredits(db, report.user_id, BUG_REWARD_CREDITS, `bug:${id}`);
    return { ok: true, already: false, credits: BUG_REWARD_CREDITS };
  });
}

export async function rejectBugReport(pool: Pool, id: string) {
  const result = await pool.query(
    "UPDATE bug_reports SET status='rejected', confirmed_at=now() WHERE id=$1 AND status='pending'",
    [id],
  );
  return Boolean(result.rowCount);
}
