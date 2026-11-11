import { workspaceContext } from "../cloud/context.js";
import { reserveCredit, finalizeCredit } from "../credits/store.js";
import { BillingError } from "./catalog.js";

export interface UsageLease {
  /** Marks the durable result as successful; the workspace transaction finalizes it. */
  complete: () => Promise<void>;
  /** Reserved for symmetry; finalization is owned by the workspace transaction. */
  release: () => Promise<void>;
}

/**
 * Reserves one analysis credit inside the current workspace transaction.
 * The finalizer runs after the SQLite snapshot is written and before the
 * Postgres transaction commits, so saved output and charged credits agree.
 */
export async function beginWorkspaceUsage(key?: string): Promise<UsageLease> {
  const context = workspaceContext.getStore();
  if (!context?.userId || !context.transaction) {
    throw new BillingError("AUTH_REQUIRED", "请登录已验证的账号", 401);
  }
  const id = await reserveCredit(context.transaction, context.userId, key ?? "");
  let success = false;
  context.finalizeUsage ??= [];
  context.finalizeUsage.push(() => finalizeCredit(context.transaction!, context.userId, id, success));
  return { complete: async () => void (success = true), release: async () => undefined };
}
