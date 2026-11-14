import { makeId } from "@wyckoff/shared";
import type { Pool } from "pg";
import { getKlines } from "./market.js";
import { sendPriceAlertEmail } from "./alertMailer.js";

export interface PriceAlertInput {
  symbol: string;
  period: string;
  adjust: string;
  targetPrice: number;
  label: string;
  language: "zh" | "en";
}

export interface PriceAlertRow {
  id: string;
  symbol: string;
  period: string;
  adjust: string;
  target_price: number;
  direction: "above" | "below";
  label: string;
  language: "zh" | "en";
  status: string;
  created_at: Date;
}

export async function createPriceAlert(pool: Pool, userId: string, input: PriceAlertInput) {
  const bars = await getKlines({
    symbol: input.symbol,
    period: input.period as Parameters<typeof getKlines>[0]["period"],
    adjust: input.adjust as Parameters<typeof getKlines>[0]["adjust"],
    count: 1,
  });
  const current = bars.at(-1)?.close;
  if (!current || !Number.isFinite(current)) throw new Error("无法读取当前价格，请稍后重试");
  const direction = input.targetPrice >= current ? "above" : "below";
  const duplicate = await pool.query(
    `SELECT 1 FROM price_alerts
     WHERE user_id=$1 AND symbol=$2 AND status='active'
       AND ABS(target_price-$3) < 0.0001`,
    [userId, input.symbol, input.targetPrice],
  );
  if (duplicate.rowCount) return { ok: true, duplicate: true };
  const id = makeId("alert");
  await pool.query(
    `INSERT INTO price_alerts(id,user_id,symbol,period,adjust,target_price,direction,label,language)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, userId, input.symbol, input.period, input.adjust, input.targetPrice, direction, input.label, input.language],
  );
  return { ok: true, duplicate: false, id, direction };
}

export async function listPriceAlerts(pool: Pool, userId: string) {
  const { rows } = await pool.query<PriceAlertRow>(
    `SELECT id,symbol,period,adjust,target_price,direction,label,language,status,created_at
     FROM price_alerts WHERE user_id=$1 AND status='active'
     ORDER BY created_at DESC LIMIT 50`,
    [userId],
  );
  return rows;
}

export async function deletePriceAlert(pool: Pool, userId: string, id: string) {
  const result = await pool.query(
    "DELETE FROM price_alerts WHERE id=$1 AND user_id=$2 AND status='active'",
    [id, userId],
  );
  return Boolean(result.rowCount);
}

interface ActiveAlert extends PriceAlertRow {
  email: string;
}

/**
 * Checks the latest daily close against active alerts. Called by Vercel Cron.
 * A failing email leaves the alert active so the next run retries it.
 */
export async function checkPriceAlerts(pool: Pool) {
  const { rows } = await pool.query<ActiveAlert>(
    `SELECT a.id,a.symbol,a.period,a.adjust,a.target_price,a.direction,a.label,a.language,a.status,a.created_at,u.email
     FROM price_alerts a JOIN "user" u ON u.id=a.user_id
     WHERE a.status='active' AND u."emailVerified"=true
     ORDER BY a.created_at`,
  );
  if (!rows.length) return { checked: 0, sent: 0, failed: 0 };

  const barsByKey = new Map<string, number | null>();
  let sent = 0;
  let failed = 0;
  for (const alert of rows) {
    const key = `${alert.symbol}|${alert.period}|${alert.adjust}`;
    let close = barsByKey.get(key);
    if (close === undefined) {
      try {
        const bars = await getKlines({
          symbol: alert.symbol,
          period: alert.period as Parameters<typeof getKlines>[0]["period"],
          adjust: alert.adjust as Parameters<typeof getKlines>[0]["adjust"],
          count: 1,
        });
        close = bars.at(-1)?.close ?? null;
      } catch {
        close = null;
      }
      barsByKey.set(key, close);
    }
    if (close === null) continue;
    const hit = alert.direction === "above" ? close >= Number(alert.target_price) : close <= Number(alert.target_price);
    if (!hit) continue;
    try {
      await sendPriceAlertEmail({
        to: alert.email,
        language: alert.language,
        symbol: alert.symbol,
        label: alert.label,
        target: Number(alert.target_price),
        current: close,
      });
      await pool.query(
        "UPDATE price_alerts SET status='sent', sent_at=now() WHERE id=$1 AND status='active'",
        [alert.id],
      );
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error("[alerts] email failed:", error instanceof Error ? error.message : error);
    }
  }
  return { checked: rows.length, sent, failed };
}
