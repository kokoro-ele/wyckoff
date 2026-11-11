export type Plan = "free" | "pro" | "research";
export type PaidPlan = Exclude<Plan, "free">;
export type Period = "monthly" | "annual";
export type Provider = "stripe" | "wechat";

/**
 * Legacy subscription plans are no longer sold. They remain in the schema so
 * already-paid monthly/annual entitlements can still be consumed before a
 * user's permanent credit balance.
 */
export const plans = [
  { id: "free" as const, limits: { analysis: 3 } },
  { id: "pro" as const, limits: { analysis: 50 } },
  { id: "research" as const, limits: { analysis: 200 } },
];

export class BillingError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: 400 | 401 | 402 | 409 | 429 | 503 = 400,
  ) {
    super(message);
  }
}

export function billingErrorResponse(error: unknown): {
  body: { error: string; code: string };
  status: 400 | 401 | 402 | 409 | 429 | 503;
} {
  return error instanceof BillingError
    ? { body: { error: error.message, code: error.code }, status: error.status }
    : { body: { error: "Billing temporarily unavailable", code: "BILLING_UNAVAILABLE" }, status: 503 };
}

export function addPeriod(date: Date, period: Period) {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + (period === "annual" ? 12 : 1));
  const last = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, last));
  return result;
}
