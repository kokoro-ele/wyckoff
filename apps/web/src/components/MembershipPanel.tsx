import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { X, RefreshCw, Copy } from "lucide-react";

type Provider = "wechat" | "stripe";
interface Pack { id: string; name: string; credits: number; amount: number; currency: string }
interface Catalog { packs: Pack[]; providers: Record<Provider, { available: boolean }> }
interface Status { balance: number; inviteCode: string; inviteCount: number }
interface Order { status: string; orderId: string; checkoutUrl?: string; codeUrl?: string; expiresAt: string }
type RequestError = Error & { code?: string };
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/credits/${path}`, { credentials: "same-origin", ...init });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    code?: string;
  };
  if (!response.ok) {
    const error = new Error(body.error || body.message || "额度服务暂时不可用，请稍后重试") as RequestError;
    error.code = body.code;
    throw error;
  }
  return body as T;
}
const terminal = (order: Order) => ["paid", "expired", "failed", "cancelled"].includes(order.status);
export function MembershipPanel({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [provider, setProvider] = useState<Provider>("wechat");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [orderLoading, setOrderLoading] = useState(true);
  const attempt = useRef<{ choice: string; key: string } | null>(null);
  const reload = async () => {
    setError("");
    const results = await Promise.allSettled([request<Catalog>("catalog"), request<Status>("status")]);
    if (results[0].status === "fulfilled") setCatalog(results[0].value);
    if (results[1].status === "fulfilled") setStatus(results[1].value);
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") setError(failed.reason instanceof Error ? failed.reason.message : "无法读取额度信息");
  };
  useEffect(() => {
    const el = dialog.current; el?.showModal(); void reload();
    const refresh = () => { void reload(); };
    window.addEventListener("credits:changed", refresh);
    const orderId = new URLSearchParams(window.location.search).get("order");
    if (orderId) void request<Order>(`orders/${encodeURIComponent(orderId)}`).then(setOrder).catch(() => setError("无法读取返回的支付订单，请刷新额度确认结果。" )).finally(() => setOrderLoading(false));
    else void request<{ order: Order | null }>("orders/current").then(result => setOrder(result.order)).catch(() => setError("无法读取待支付订单，请刷新后再购买。" )).finally(() => setOrderLoading(false));
    return () => { window.removeEventListener("credits:changed", refresh); el?.close(); };
  }, []);
  useEffect(() => {
    if (!catalog) return;
    if (catalog.providers[provider]?.available) return;
    const fallback: Provider = provider === "wechat" ? "stripe" : "wechat";
    if (catalog.providers[fallback]?.available) setProvider(fallback);
  }, [catalog, provider]);
  useEffect(() => {
    if (!order || terminal(order)) return;
    const timer = window.setInterval(() => { void Promise.all([request<Order>(`orders/${encodeURIComponent(order.orderId)}`), request<Status>("status")]).then(([next, current]) => { setOrder(next); setStatus(current); setError(""); }).catch(() => setError("暂时无法查询支付状态，请稍后刷新；请勿重复付款。")); }, 5000);
    return () => window.clearInterval(timer);
  }, [order]);
  const buy = async (packId: string) => {
    if (busy || orderLoading || (order && !terminal(order))) return;
    setBusy(true); setError("");
    if (order && terminal(order)) attempt.current = null;
    const choice = `${packId}:${provider}`;
    if (attempt.current?.choice !== choice) attempt.current = { choice, key: crypto.randomUUID() };
    try {
      const result = await request<Order>("checkout", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current.key }, body: JSON.stringify({ packId, provider }) });
      setOrder(result);
      if (result.checkoutUrl) {
        const url = new URL(result.checkoutUrl);
        if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com") throw new Error("支付链接无效，请稍后重试");
        window.location.assign(url.href);
      }
    } catch (e) {
      const code = (e as RequestError).code;
      // A failed server-side checkout poisons this idempotency key. A network
      // error is ambiguous, so it keeps the key and retries safely.
      if (code === "CHECKOUT_FAILED" || code === "IDEMPOTENCY_CONFLICT") attempt.current = null;
      setError(e instanceof Error ? e.message : "创建订单失败");
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
    } catch { setError("支付链接无效，请稍后重试"); }
  };
  const copy = async (link: boolean) => {
    if (!status) return;
    const url = new URL("/", window.location.origin); url.searchParams.set("invite", status.inviteCode);
    try { await navigator.clipboard.writeText(link ? url.href : status.inviteCode); setNotice(link ? "邀请链接已复制" : "邀请码已复制"); }
    catch { setError("复制失败，请手动复制邀请码。"); }
  };
  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="credits-title" className="m-auto max-h-[90vh] w-[min(760px,94vw)] overflow-auto rounded-2xl border border-line bg-panel p-6 text-ink shadow-2xl backdrop:bg-black/50">
    <div className="flex items-start justify-between gap-4"><div><h2 id="credits-title" className="mt-2 text-xl font-semibold">充值与邀请</h2><p className="mt-2 text-sm text-ink-muted">分析次数永久有效，不按月清零。</p></div><button aria-label="关闭充值窗口" onClick={onClose} className="rounded p-2 hover:bg-accent/10"><X size={20} /></button></div>
    {error && <div role="alert" className="mt-4 rounded-lg border border-red-500/30 p-3 text-sm">{error}<button onClick={() => void reload()} className="ml-3 underline">刷新</button></div>}
    {status && <section className="mt-5 rounded-xl border border-line p-4"><div className="flex items-center justify-between"><p>剩余 <strong className="text-2xl text-accent">{status.balance}</strong> 次</p><button aria-label="刷新额度" onClick={() => void reload()} className="p-2"><RefreshCw size={16} /></button></div><p className="mt-3 text-sm">邀请码：<code className="select-all">{status.inviteCode}</code></p><p className="mt-2 text-xs text-ink-muted">成功邀请 {status.inviteCount} 人。新用户验证邮箱获赠 3 次；每邀请一位新用户完成验证，你再获赠 3 次。</p><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => void copy(false)} className="inline-flex items-center gap-1 rounded border border-line px-3 py-2 text-xs"><Copy size={12} />复制邀请码</button><button onClick={() => void copy(true)} className="rounded border border-line px-3 py-2 text-xs">复制邀请链接</button></div>{notice && <p role="status" className="mt-2 text-xs text-accent">{notice}</p>}</section>}
    {!catalog && !error && <p className="py-8 text-center text-ink-muted">正在读取次数包…</p>}
    {catalog && <>
      <label className="my-5 block text-sm">付款方式 <select aria-label="付款方式" value={provider} onChange={e => setProvider(e.target.value as Provider)} className="ml-2 rounded border border-line bg-panel p-2"><option value="wechat">微信支付</option><option value="stripe">信用卡</option></select></label>
      {!catalog.providers[provider].available && <p className="mb-4 rounded-lg bg-accent/10 p-3 text-sm">此付款方式尚未开通，目前无法购买。</p>}
      {catalog.packs.length === 0 && <p className="rounded-lg border border-line p-4 text-sm text-ink-muted">次数包尚未开放购买。你可以通过邀请获得更多分析次数。</p>}
      <div className="grid gap-4 sm:grid-cols-2">{catalog.packs.map(pack => <section key={pack.id} className="rounded-xl border border-line p-5"><h3 className="text-lg font-semibold">{pack.name}</h3><p className="my-3 text-2xl font-semibold">{pack.credits} 次</p><p className="text-sm text-ink-muted">{new Intl.NumberFormat("zh-CN", { style: "currency", currency: pack.currency }).format(pack.amount / 100)} · 永久有效</p><button disabled={busy || orderLoading || (!!order && !terminal(order)) || !catalog.providers[provider].available || (provider === "wechat" && pack.currency.toUpperCase() !== "CNY")} onClick={() => void buy(pack.id)} className="mt-4 w-full rounded-lg bg-accent px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40">{busy ? "正在创建订单…" : "购买次数包"}</button></section>)}</div>
      <p className="mt-4 text-xs leading-6 text-ink-muted">每次分析或追问消耗 1 次，失败自动返还。查看历史、图表和手动标注不扣次。付款成功后到账，以服务端确认结果为准。</p>
    </>}
    {order && <div className="mt-5 rounded-xl border border-line p-5 text-center"><h3 className="font-semibold">{order.status === "paid" ? "支付已确认，次数已到账" : terminal(order) ? "订单已结束，可重新购买" : "等待支付确认"}</h3>{order.checkoutUrl && order.status === "pending" && <button onClick={resumePayment} className="mt-3 rounded-lg border border-line px-3 py-2 text-sm">继续付款</button>}{order.codeUrl && order.status === "pending" && <><div className="mx-auto my-4 w-fit bg-white p-4"><QRCodeSVG value={order.codeUrl} size={200} /></div><p className="text-sm">请使用微信扫一扫。二维码有效至 {new Date(order.expiresAt).toLocaleTimeString()}。</p></>}<p className="mt-2 text-xs text-ink-muted">订单 {order.orderId}</p></div>}
  </dialog>;
}
