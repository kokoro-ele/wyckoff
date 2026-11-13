import { useEffect, useState } from "react";
import { Copy, Crown, LogIn, LogOut, RefreshCw, X } from "lucide-react";
import { authClient } from "../lib/auth.js";
import { fetchByokSubscriptionStatus, fetchCreditStatus, type ByokStatus, type CreditStatus } from "../lib/api.js";
import { useAuth } from "../auth/AuthProvider.js";
import { useI18n } from "../i18n.js";

export function AccountPanel({
  onClose,
  onOpenTopUp,
}: {
  onClose: () => void;
  onOpenTopUp: () => void;
}) {
  const { t, lang } = useI18n();
  const { session, isVerified, openAuth } = useAuth();
  const [status, setStatus] = useState<CreditStatus | null>(null);
  const [byok, setByok] = useState<ByokStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const reload = async () => {
    if (!isVerified) return;
    setLoading(true);
    setError("");
    const [credit, subscription] = await Promise.allSettled([
      fetchCreditStatus(),
      fetchByokSubscriptionStatus(),
    ]);
    if (credit.status === "fulfilled") setStatus(credit.value);
    else setError(credit.reason instanceof Error ? credit.reason.message : t("account.error"));
    if (subscription.status === "fulfilled") setByok(subscription.value);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
  }, [isVerified]);

  const copy = async (link: boolean) => {
    if (!status) return;
    const url = new URL("/app", window.location.origin);
    url.searchParams.set("invite", status.inviteCode);
    try {
      await navigator.clipboard.writeText(link ? url.href : status.inviteCode);
      setNotice(link ? t("membership.noticeLink") : t("membership.noticeCode"));
    } catch {
      setError(t("membership.copyFailed"));
    }
  };

  const logout = async () => {
    await authClient.signOut();
    window.location.reload();
  };

  return (
    <div
      className="mobile-modal-backdrop fixed inset-0 z-50 flex items-start justify-center bg-ink/35 px-4 pt-[10vh] backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="account-title" className="hand-card w-full max-w-[520px] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="hand-eyebrow">WYCKOFF · ACCOUNT</div>
            <h2 id="account-title" className="mt-1 text-[22px] font-semibold">{t("account.title")}</h2>
          </div>
          <button type="button" aria-label={t("action.close")} className="hand-icon" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        {!isVerified ? (
          <div className="mt-5">
            <div className="hand-doodle flex h-16 w-16 items-center justify-center rounded-full border border-line bg-panel-2">
              <LogIn size={24} />
            </div>
            <p className="mt-4 text-sm font-semibold">{t("account.guest")}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-dim">{t("account.guestHint")}</p>
            <button type="button" className="hand-btn hand-btn-primary mt-5 flex w-full items-center justify-center gap-2 px-3 py-2.5 text-sm" onClick={() => openAuth()}>
              <LogIn size={15} />
              {t("account.login")}
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="hand-doodle flex h-12 w-12 items-center justify-center rounded-full border border-line bg-accent-soft text-lg font-semibold text-accent">
                {(session?.user.name || session?.user.email || "?").slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{session?.user.name || session?.user.email}</p>
                <p className="truncate text-xs text-ink-dim">{session?.user.email}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex rounded-full border border-down/30 bg-down/10 px-2 py-0.5 text-[10px] text-down">{t("common.loggedIn")}</span>
                  {status?.publicId && <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] text-ink-faint">{status.publicId}</span>}
                  {status?.earlyBird && <span className="rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[9px] text-warn">{t("account.earlyBird")}</span>}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <section className="rounded-2xl border border-line bg-panel-2/70 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-ink-dim">{t("account.balance")}</span>
                  <button type="button" aria-label={t("action.refresh")} className="hand-icon" onClick={() => void reload()}>
                    <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                  </button>
                </div>
                <p className="mt-1 text-3xl font-semibold text-accent">
                  {status ? status.balance : loading ? "…" : "—"}
                  <span className="ml-1 text-sm font-normal text-ink-dim">{t("common.credits")}</span>
                </p>
                {error && <p role="alert" className="mt-2 text-xs text-warn">{error}</p>}
              </section>

              <section className="rounded-2xl border border-line bg-panel-2/70 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-ink-dim">{t("account.subscription")}</span>
                  <Crown size={14} className="text-accent" />
                </div>
                <p className="mt-1 text-sm font-semibold text-ink">
                  {byok?.byok
                    ? byok.entitlement?.source === "lifetime"
                      ? t("account.subscriptionLifetime")
                      : t("account.subscriptionActive")
                    : t("account.subscriptionNone")}
                </p>
                <p className="mt-1 text-[10px] text-ink-faint">
                  {byok?.byok && byok.entitlement?.currentPeriodEnd
                    ? t("account.subscriptionExpires", { date: new Date(byok.entitlement.currentPeriodEnd).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US") })
                    : ""}
                </p>
              </section>
            </div>

            {status && (
              <section className="rounded-2xl border border-line bg-panel-2/70 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-ink-dim">{t("account.invite")}</span>
                  <span className="text-[11px] text-ink-faint">{t("account.inviteCount", { n: status.inviteCount })}</span>
                </div>
                <code className="mt-2 block select-all break-all text-sm text-ink">{status.inviteCode}</code>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="hand-btn inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px]" onClick={() => void copy(false)}>
                    <Copy size={12} />
                    {t("account.copyCode")}
                  </button>
                  <button type="button" className="hand-btn px-2.5 py-1.5 text-[11px]" onClick={() => void copy(true)}>
                    {t("account.copyLink")}
                  </button>
                </div>
                {notice && <p role="status" className="mt-2 text-[11px] text-accent">{notice}</p>}
              </section>
            )}

            <button
              type="button"
              className="hand-btn hand-btn-primary flex w-full items-center justify-center gap-2 px-3 py-2.5 text-sm"
              onClick={onOpenTopUp}
            >
              <Crown size={15} />
              {t("account.topUp")}
            </button>
            <button
              type="button"
              className="hand-link flex w-full items-center justify-center gap-1 text-xs text-ink-faint"
              onClick={() => void logout()}
            >
              <LogOut size={12} />
              {t("account.logout")}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
