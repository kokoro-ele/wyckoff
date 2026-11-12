import { useEffect, useState } from "react";
import { ArrowLeft, Coins, RefreshCw, Search, ShieldCheck, Users, WalletCards } from "lucide-react";
import * as api from "@/lib/api.js";
import { useAuth } from "@/auth/AuthProvider.js";
import { useI18n } from "@/i18n.js";

function fmtDate(value: string | Date | null | undefined, lang: "zh" | "en"): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function AdminPage() {
  const { lang } = useI18n();
  const { isPending, isVerified, openAuth } = useAuth();
  const [overview, setOverview] = useState<api.AdminOverview | null>(null);
  const [users, setUsers] = useState<api.AdminUser[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const zh = lang === "zh";

  const load = async (q = query) => {
    setError("");
    try {
      const [o, u] = await Promise.all([api.fetchAdminOverview(), api.fetchAdminUsers(q)]);
      setOverview(o);
      setUsers(u.users);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Admin unavailable");
    }
  };

  useEffect(() => {
    if (isVerified) void load("");
    // initial load only
  }, [isVerified]);

  const setBalance = async (user: api.AdminUser, balance: number) => {
    setBusy(user.id);
    setError("");
    try {
      await api.setAdminCredits(user.id, balance);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Update failed");
    } finally {
      setBusy("");
    }
  };

  const resetAll = async () => {
    if (!window.confirm(zh ? "把所有用户的次数重置为 3 次？" : "Reset every user to 3 credits?")) return;
    setBusy("reset");
    setError("");
    try {
      await api.resetAdminCredits(3);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reset failed");
    } finally {
      setBusy("");
    }
  };

  if (isPending) return <div className="admin-empty">…</div>;
  if (!isVerified) {
    return (
      <div className="admin-shell">
        <div className="admin-empty">
          <ShieldCheck size={32} />
          <p>{zh ? "请先登录管理员账号。" : "Sign in with the admin account."}</p>
          <button type="button" className="hand-btn hand-btn-primary" onClick={openAuth}>
            {zh ? "登录" : "Sign in"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <a href="/" className="admin-brand"><span className="site-brand-mark">W</span>EasyWyckoff <small>admin</small></a>
        <a href="/app" className="hand-btn px-3 py-1.5 text-xs"><ArrowLeft size={13} />{zh ? "返回工作台" : "Back to workbench"}</a>
      </header>

      <main className="admin-main">
        <div className="admin-heading">
          <div>
            <div className="site-kicker">OPERATIONS · PRIVATE</div>
            <h1>{zh ? "管理面板" : "Admin dashboard"}</h1>
            <p>{zh ? "用户、次数和订单概览。此页面仅管理员可见。" : "Users, credits and orders. Visible to admins only."}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="hand-btn px-3 py-1.5 text-xs" onClick={() => void load()}>
              <RefreshCw size={13} />{zh ? "刷新" : "Refresh"}
            </button>
            <button type="button" className="hand-btn hand-btn-primary px-3 py-1.5 text-xs" disabled={busy === "reset"} onClick={() => void resetAll()}>
              <Coins size={13} />{zh ? "全员重置为 3 次" : "Reset everyone to 3"}
            </button>
          </div>
        </div>

        {error && <div className="admin-error">{error}</div>}

        {overview && (
          <div className="admin-stats">
            <div className="hand-card"><Users size={16} /><span>{zh ? "用户" : "Users"}</span><strong>{overview.users}</strong></div>
            <div className="hand-card"><ShieldCheck size={16} /><span>{zh ? "已验证" : "Verified"}</span><strong>{overview.verified}</strong></div>
            <div className="hand-card"><Coins size={16} /><span>{zh ? "剩余总次数" : "Credits left"}</span><strong>{overview.credits}</strong></div>
            <div className="hand-card"><WalletCards size={16} /><span>{zh ? "已用分析" : "Analyses used"}</span><strong>{overview.analyses}</strong></div>
            <div className="hand-card"><WalletCards size={16} /><span>{zh ? "已付款订单" : "Paid orders"}</span><strong>{overview.orders}</strong></div>
            <div className="hand-card"><WalletCards size={16} /><span>{zh ? "收入（最小单位）" : "Revenue (minor)"}</span><strong>{overview.revenueMinor}</strong></div>
          </div>
        )}

        <section className="admin-section">
          <div className="admin-section-head">
            <h2>{zh ? "用户次数" : "User credits"}</h2>
            <form className="admin-search" onSubmit={(event) => { event.preventDefault(); void load(query); }}>
              <Search size={13} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? "搜索邮箱或昵称" : "Search email or name"} />
            </form>
          </div>
          <div className="admin-table-wrap hand-card">
            <table className="admin-table">
              <thead><tr><th>{zh ? "用户" : "User"}</th><th>{zh ? "状态" : "Status"}</th><th>{zh ? "次数" : "Credits"}</th><th>{zh ? "已用" : "Used"}</th><th>{zh ? "注册" : "Joined"}</th><th>{zh ? "调整" : "Adjust"}</th></tr></thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td><div className="admin-user"><strong>{user.name || user.email.split("@")[0]}</strong><span>{user.email}</span></div></td>
                    <td>{user.emailVerified ? <span className="admin-pill ok">{zh ? "已验证" : "verified"}</span> : <span className="admin-pill">{zh ? "待验证" : "pending"}</span>}</td>
                    <td className="font-mono">{user.balance}</td>
                    <td className="font-mono">{user.analyses}</td>
                    <td>{fmtDate(user.createdAt, lang)}</td>
                    <td>
                      <div className="admin-actions">
                        <button type="button" disabled={busy === user.id} onClick={() => void setBalance(user, user.balance + 3)}>+3</button>
                        <button type="button" disabled={busy === user.id} onClick={() => void setBalance(user, 3)}>3</button>
                        <button type="button" disabled={busy === user.id} onClick={() => void setBalance(user, 0)}>0</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="admin-columns">
          <section className="admin-section hand-card">
            <h2>{zh ? "最近注册" : "Recent signups"}</h2>
            {overview?.recentSignups.map((user) => (
              <div key={user.id} className="admin-list-row"><span>{user.email}</span><span>{fmtDate(user.createdAt, lang)}</span></div>
            ))}
          </section>
          <section className="admin-section hand-card">
            <h2>{zh ? "最近订单" : "Recent orders"}</h2>
            {overview?.recentOrders.length ? overview.recentOrders.map((order) => (
              <div key={order.id} className="admin-list-row"><span>{order.plan} · {order.status}</span><span>{order.amount} {order.currency}</span></div>
            )) : <p className="text-[11px] text-ink-faint">{zh ? "暂无订单" : "No orders yet"}</p>}
          </section>
        </div>
      </main>
    </div>
  );
}
