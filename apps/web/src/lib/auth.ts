import { createAuthClient } from "better-auth/react";
import { translate } from "../i18n.js";
import { emailOTPClient } from "better-auth/client/plugins";
export const authClient = createAuthClient({ plugins: [emailOTPClient()] });
export async function prepareReferral(code: string) {
  const response = await fetch("/api/auth/referral-intent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  if (!response.ok) throw new Error(translate("auth.inviteInvalid"));
}
