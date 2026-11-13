export const X_REGISTRATION_EVENT = "tw-riyf1-rizdq";

type Twq = (...args: unknown[]) => void;

/**
 * Fire the X registration conversion after a new account is created.
 * The base pixel is installed in index.html; this only enqueues the event.
 */
export function trackXRegistration(email: string | null | undefined): void {
  if (typeof window === "undefined") return;
  const twq = (window as Window & { twq?: Twq }).twq;
  if (!twq) return;
  try {
    const params: Record<string, string> = {};
    if (email) params.email_address = email;
    // X treats explicit nulls as "supplied but empty" parameters. Only send
    // fields that actually have a value.
    twq("event", X_REGISTRATION_EVENT, params);
  } catch {
    // Conversion tracking must never block registration.
  }
}
