import { useEffect, useRef, useState } from "react";
import { Copy, CreditCard, Crown, RefreshCw, X } from "lucide-react";
import { translate, useI18n } from "@/i18n.js";
import { fetchByokSubscriptionStatus, fetchPurchases, openBillingPortal, type ByokStatus, type PurchaseRecord } from "@/lib/api.js";

interface Pack { id: string; name: string; credits: number; amount: number; currency: string }
interface Catalog { packs: Pack[]; providers: { stripe: { available: boolean; mode?: "test" | "live" | null } } }
interface Status { balance: number; inviteCode: string; inviteCount: number }
interface Order { status: string; orderId: string; checkoutUrl?: string; expiresAt: string }
type RequestError = Error & { code?: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/credits/${path}`, { credentials: "same-origin", ...init });
  const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string; code?: string };
  if (!response.ok) {
    const error = new Error(body.error || body.message || translate("error.SERVICE_UNAVAILABLE")) as RequestError;
    error.code = body.code;
    throw error;
  }
  return body as T;
}

const terminal = (order: Order) => ["paid", "expired", "failed", "cancelled"].includes(order.status);

export function MembershipPanel({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [byok, setByok] = useState<ByokStatus | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [orderLoading, setOrderLoading] = useState(true);
  const attempt = useRef<{ choice: string; key: string } | null>(null);

  const reload = async () => {
    setError("");
    const results = await Promise.allSettled([
      request<Catalog>("catalog"),
      request<Status>("status"),
      fetchPurchases(),
      fetchByokSubscriptionStatus(),
    ]);
    if (results[0].status === "fulfilled") setCatalog(results[0].value);
    if (results[1].status === "fulfilled") setStatus(results[1].value);
    if (results[2].status === "fulfilled") setPurchases(results[2].value.purchases);
    if (results[3].status === "fulfilled") setByok(results[3].value);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {
      setError(failed.reason instanceof Error ? failed.reason.message : t("account.error"));
    }
  };

  useEffect(() => {
    void reload();
    const refresh = () => void reload();
    window.addEventListener("credits:changed", refresh);
    const orderId = new URLSearchParams(window.location.search).get("order");
    if (orderId) {
      void request<Order>(`orders/${encodeURIComponent(orderId)}`)
        .then(setOrder)
        .catch(() => setError(t("account.error")))
        .finally(() => setOrderLoading(false));
    } else {
      void request<{ order: Order | null }>("orders/current")
        .then((result) => setOrder(result.order))
        .catch(() => setError(t("account.error")))
        .finally(() => setOrderLoading(false));
    }
    return () => window.removeEventListener("credits:changed", refresh);
  }, []);

  useEffect(() => {
    if (!order || terminal(order)) return;
    const timer = window.setInterval(() => {
      void Promise.all([
        request<Order>(`orders/${encodeURIComponent(order.orderId)}`),
        request<Status>("status"),
      ])
        .then(([next, current]) => {
          setOrder(next);
          setStatus(current);
          setError("");
        })
        .catch(() => setError(t("account.error")));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [order, t]);

  const buy = async (packId: string) => {
    if (busy || orderLoading || (order && !terminal(order))) return;
    setBusy(true);
    setError("");
    if (order && terminal(order)) attempt.current = null;
    const choice = `${packId}:stripe`;
    if (attempt.current?.choice !== choice) attempt.current = { choice, key: crypto.randomUUID() };
    try {
      const result = await request<Order>("checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current.key },
        body: JSON.stringify({ packId, provider: "stripe" }),
      });
      setOrder(result);
      if (result.checkoutUrl) {
        const url = new URL(result.checkoutUrl);
        if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com") {
          throw new Error(t("error.SERVICE_UNAVAILABLE"));
        }
        window.location.assign(url.href);
      }
    } catch (cause) {
      const code = (cause as RequestError).code;
      if (code === "CHECKOUT_FAILED" || code === "IDEMPOTENCY_CONFLICT") attempt.current = null;
      setError(cause instanceof Error ? cause.message : t("error.NETWORK"));
    } finally {
      setBusy(false);
    }
  };

  const resumePayment = () => {
    if (!order?.checkoutUrl) return;
    try {
      const url = new URL(order.checkoutUrl);
      if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com") throw new Error();
      window.location.assign(url.href);
    } catch {
      setError(t("error.SERVICE_UNAVAILABLE"));
    }
  };

  const manage = async () => {
    setBusy(true);
    setError("");
    try {
      const { url } = await openBillingPortal();
      window.location.assign(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("error.SERVICE_UNAVAILABLE"));
    } finally {
      setBusy(false);
    }
  };

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

  return (
    <div
      className="mobile-modal-backdrop fixed inset-0 z-50 flex items-start justify-center bg-ink/35 px-4 pt-[8vh] backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section role="dialog" aria-modal="true" aria-labelledby="credits-title" className="hand-card max-h-[90vh] w-full max-w-[760px] overflow-auto p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="hand-eyebrow">WYCKOFF · CREDITS</div>
            <h2 id="credits-title" className="mt-1 text-[22px] font-semibold">{t("membership.title")}</h2>
            <p className="mt-1 text-sm text-ink-dim">{t("membership.subtitle")}</p>
          </div>
          <button type="button" aria-label={t("action.close")} className="hand-icon" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        {error && (
          <div role="alert" className="mt-4 rounded-xl border border-warn/30 bg-warn/10 p-3 text-sm">
            {error}
            <button type="button" onClick={() => void reload()} className="hand-link ml-3">
              {t("action.refresh")}
            </button>
          </div>
        )}

        {catalog?.providers.stripe.mode && (
          <div className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] ${catalog.providers.stripe.mode === "live" ? "border-down/40 bg-down/10 text-down" : "border-warn/40 bg-warn/10 text-warn"}`}>
            {catalog.providers.stripe.mode === "live" ? "STRIPE LIVE" : "STRIPE TEST"}
          </div>
        )}

        {byok && (
          <section className="mt-4 rounded-2xl border border-line bg-panel-2/70 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">BYOK</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] ${byok.byok ? "border-down/40 text-down" : "border-line text-ink-faint"}`}>
                {byok.byok ? (byok.entitlement?.source === "lifetime" ? "Lifetime" : "Active") : "Not active"}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-ink-dim">
              {byok.byok
                ? `${byok.entitlement?.source === "lifetime" ? "永久" : "订阅有效至"} ${byok.entitlement?.currentPeriodEnd ? new Date(byok.entitlement.currentPeriodEnd).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US") : ""}`
                : "使用自己的模型需要开通 BYOK。"}
            </p>
            {byok.byok && byok.entitlement?.source === "subscription" && (
              <button type="button" className="hand-link mt-1 text-[10px]" disabled={busy} onClick={() => void manage()}>
                管理订阅 / 取消
              </button>
            )}
          </section>
        )}

        {status && (
          <section className="mt-4 rounded-2xl border border-line bg-panel-2/70 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm">{t("membership.balance", { n: status.balance })}</p>
              <button type="button" aria-label={t("membership.refresh")} className="hand-icon" onClick={() => void reload()}>
                <RefreshCw size={15} />
              </button>
            </div>
            <p className="mt-3 text-sm">
              {t("membership.invite")}: <code className="select-all">{status.inviteCode}</code>
            </p>
            <p className="mt-1.5 text-xs text-ink-dim">{t("membership.inviteHint", { n: status.inviteCount })}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => void copy(false)} className="hand-btn inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px]">
                <Copy size={12} />
                {t("membership.copyCode")}
              </button>
              <button type="button" onClick={() => void copy(true)} className="hand-btn px-2.5 py-1.5 text-[11px]">
                {t("membership.copyLink")}
              </button>
            </div>
            {notice && <p role="status" className="mt-2 text-[11px] text-accent">{notice}</p>}
          </section>
        )}

        {!catalog && !error && <p className="py-8 text-center text-ink-dim">{t("action.loading")}</p>}
        {catalog && (
          <>
            <div className="mt-5 flex items-center justify-between gap-2 text-sm">
              <span>{t("membership.provider")}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel-2 px-2.5 py-1 text-xs">
                <CreditCard size={13} />
                {t("membership.stripe")}
              </span>
            </div>
            {!catalog.providers.stripe.available && (
              <p className="mt-3 rounded-xl border border-line bg-panel-2/60 p-3 text-sm text-ink-dim">
                {t("membership.stripeUnavailable")}
              </p>
            )}
            {catalog.packs.length === 0 && (
              <p className="mt-3 rounded-xl border border-line p-4 text-sm text-ink-dim">{t("membership.noPacks")}</p>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {catalog.packs.map((pack) => (
                <section key={pack.id} className="hand-card p-4">
                  <h3 className="text-lg font-semibold">{pack.name}</h3>
                  <p className="my-2 text-2xl font-semibold text-accent">
                    {pack.credits}
                    <span className="ml-1 text-sm font-normal text-ink-dim">{t("common.credits")}</span>
                  </p>
                  <p className="text-sm text-ink-dim">
                    {new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US", {
                      style: "currency",
                      currency: pack.currency,
                    }).format(pack.amount / 100)}
                  </p>
                  <button
                    type="button"
                    disabled={busy || orderLoading || (!!order && !terminal(order)) || !catalog.providers.stripe.available}
                    onClick={() => void buy(pack.id)}
                    className="hand-btn hand-btn-primary mt-4 w-full px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy ? t("membership.busy") : t("membership.buy")}
                  </button>
                </section>
              ))}
            </div>
            <section className="mt-5 border-t border-dashed border-line-soft pt-3">
              <h3 className="text-sm font-semibold">购买记录</h3>
              {purchases.length === 0 ? (
                <p className="mt-2 text-[11px] text-ink-faint">暂无购买记录。</p>
              ) : (
                <div className="mt-2 space-y-1">
                  {purchases.slice(0, 12).map((purchase) => (
                    <div key={`${purchase.kind}-${purchase.id}`} className="flex items-center justify-between gap-3 border-b border-dashed border-line-soft py-1.5 text-[11px]">
                      <div className="min-w-0">
                        <div className="truncate text-ink">
                          {purchase.kind === "credits"
                            ? purchase.credits ? `${purchase.credits} credits` : purchase.product
                            : purchase.product === "byok_lifetime" ? "BYOK Lifetime" : "BYOK Monthly"}
                        </div>
                        <div className="text-[9px] text-ink-faint">{new Date(purchase.created_at).toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-ink">{new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US", { style: "currency", currency: purchase.currency }).format(purchase.amount / 100)}</div>
                        <div className="text-[9px] text-ink-faint">{purchase.status}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <p className="mt-4 text-xs leading-6 text-ink-dim">{t("membership.footnote")}</p>
          </>
        )}

        {order && (
          <div className="mt-5 rounded-2xl border border-line p-4 text-center">
            <h3 className="inline-flex items-center gap-1.5 font-semibold">
              <Crown size={15} className="text-accent" />
              {order.status === "paid"
                ? t("membership.paid")
                : terminal(order)
                  ? t("membership.ended")
                  : t("membership.pending")}
            </h3>
            {order.checkoutUrl && order.status === "pending" && (
              <button type="button" onClick={resumePayment} className="hand-btn mt-3 px-3 py-2 text-sm">
                {t("membership.resume")}
              </button>
            )}
            <p className="mt-2 text-xs text-ink-faint">{t("membership.order", { id: order.orderId })}</p>
          </div>
        )}
      </section>
    </div>
  );
}
