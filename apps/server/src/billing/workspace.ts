import { workspaceContext } from "../cloud/context.js";
import { getPool } from "../cloud/postgres.js";
import { finalizeCreditNow, reserveCreditNow } from "../credits/store.js";
import { BillingError } from "./catalog.js";

export interface UsageLease {
  /** Marks the durable result as successful; settlement happens after the workspace is saved. */
  complete: (usage?: { inputTokens: number; outputTokens: number }) => Promise<void>;
  /** Reserved for symmetry; settlement is owned by the workspace. */
  release: () => Promise<void>;
}

/**
 * Reserves one analysis credit in its own short transaction, so a running
 * analysis never holds a lock on the credit account. The reservation is
 * consumed only if the analysis succeeded AND its workspace snapshot was
 * saved; otherwise it is refunded.
 */
export async function beginWorkspaceUsage(key?: string): Promise<UsageLease> {
  const context = workspaceContext.getStore();
  if (!context?.userId || !context.finalizeUsage) {
    throw new BillingError("AUTH_REQUIRED", "请登录已验证的账号", 401);
  }
  const pool = getPool();
  const userId = context.userId;
  const id = await reserveCreditNow(pool, userId, key ?? "");
  let success = false;
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  context.finalizeUsage.push((committed) => finalizeCreditNow(pool, userId, id, success && committed, usage));
  return {
    complete: async (value) => {
      success = true;
      usage = value;
    },
    release: async () => undefined,
  };
}
