import { useEffect, useState } from "react";
import { Activity, ArrowLeft, BarChart3, Coins, RefreshCw, Search, ShieldCheck, Users, WalletCards } from "lucide-react";
import * as api from "@/lib/api.js";
import { useAuth } from "@/auth/AuthProvider.js";
import { authClient } from "@/lib/auth.js";
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
  const { isPending, isVerified } = useAuth();
  const [loginEmail, setLoginEmail] = useState("elekokoro@gmail.com");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [overview, setOverview] = useState<api.AdminOverview | null>(null);
  const [analytics, setAnalytics] = useState<api.AdminAnalytics | null>(null);
  const [users, setUsers] = useState<api.AdminUser[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const zh = lang === "zh";

  const load = async (q = query) => {
    setError("");
    try {
      const [o, u, a] = await Promise.all([
        api.fetchAdminOverview(),
        api.fetchAdminUsers(q),
        api.fetchAdminAnalytics(),
      ]);
      setOverview(o);
      setUsers(u.users);
      setAnalytics(a);
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
          <h1>{zh ? "管理员登录" : "Admin sign in"}</h1>
          <p>{zh ? "此入口只供管理员使用。" : "This entry is for administrators only."}</p>
          <form
            className="admin-login"
            onSubmit={(event) => {
              event.preventDefault();
              setLoginBusy(true);
              setLoginError("");
              void authClient.signIn.email({ email: loginEmail.trim(), password: loginPassword }).then((result) => {
                if (result.error) {
                  setLoginError(result.error.message || (zh ? "登录失败" : "Sign in failed"));
                  setLoginBusy(false);
                  return;
                }
                window.location.reload();
              }).catch((cause) => {
                setLoginError(cause instanceof Error ? cause.message : "Sign in failed");
                setLoginBusy(false);
              });
            }}
          >
            <label className="hand-label">
              {zh ? "管理员邮箱" : "Admin email"}
              <input className="hand-input" type="email" autoComplete="username" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} required />
            </label>
            <label className="hand-label">
              {zh ? "密码" : "Password"}
              <input className="hand-input" type="password" autoComplete="current-password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required />
            </label>
            {loginError && <div className="admin-error">{loginError}</div>}
            <button type="submit" className="hand-btn hand-btn-primary w-full" disabled={loginBusy || !loginEmail || !loginPassword}>
              {loginBusy ? "…" : zh ? "进入管理面板" : "Enter dashboard"}
            </button>
          </form>
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

        {analytics && (
          <>
            <div className="admin-stats admin-today">
              <div className="hand-card"><Users size={16} /><span>{zh ? "今日注册" : "New today"}</span><strong>{analytics.today.newToday}</strong></div>
              <div className="hand-card"><Activity size={16} /><span>{zh ? "今日登录" : "Logins today"}</span><strong>{analytics.today.loginsToday}</strong></div>
              <div className="hand-card"><BarChart3 size={16} /><span>{zh ? "今日分析" : "Analyses today"}</span><strong>{analytics.today.analysesToday}</strong></div>
              <div className="hand-card"><Activity size={16} /><span>{zh ? "7 日活跃" : "Active 7d"}</span><strong>{analytics.today.active7d}</strong></div>
            </div>

            <div className="admin-columns">
              <section className="admin-section hand-card">
                <h2>{zh ? "注册 / 登录" : "Signups / logins"}</h2>
                <MiniBars rows={analytics.signups.map((row) => ({ label: row.date.slice(5), value: row.count, other: analytics.logins.find((l) => l.date === row.date)?.count ?? 0 }))} />
                <p className="admin-legend">{zh ? "实线：注册 · 浅色：登录" : "Solid: signups · light: logins"}</p>
              </section>
              <section className="admin-section hand-card">
                <h2>{zh ? "次日留存" : "Next-day retention"}</h2>
                <div className="admin-retention">
                  {analytics.retention.slice(-8).map((row) => (
                    <div key={row.date}><span>{row.date.slice(5)}</span><span className="font-mono">{row.d1}/{row.signups}</span></div>
                  ))}
                </div>
              </section>
            </div>

            <div className="admin-columns">
              <section className="admin-section hand-card">
                <h2>{zh ? "分析消耗" : "Analysis usage"}</h2>
                <MiniBars rows={analytics.analyses.map((row) => ({ label: row.date.slice(5), value: row.analyses }))} />
                <div className="admin-retention mt-3">
                  <div><span>{zh ? "近 30 天次数" : "30d analyses"}</span><span className="font-mono">{analytics.cost.analyses30d}</span></div>
                  <div><span>{zh ? "人均（已验证用户）" : "Per verified user"}</span><span className="font-mono">{analytics.cost.avgPerVerifiedUser.toFixed(2)}</span></div>
                  <div><span>{zh ? "人均（活跃用户）" : "Per active user"}</span><span className="font-mono">{analytics.cost.avgPerActiveUser.toFixed(2)}</span></div>
                  <div><span>{zh ? "单次对话" : "Per conversation"}</span><span className="font-mono">{analytics.cost.creditsPerAnalysis} credit</span></div>
                </div>
                <p className="admin-legend">{analytics.cost.note}</p>
              </section>
              <section className="admin-section hand-card">
                <h2>{zh ? "用户消耗 Top 10" : "Top users by usage"}</h2>
                {analytics.perUser.map((row) => (
                  <div key={row.email} className="admin-list-row"><span>{row.email}</span><span className="font-mono">{row.analyses}</span></div>
                ))}
              </section>
            </div>
          </>
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

function MiniBars({ rows }: { rows: { label: string; value: number; other?: number }[] }) {
  const max = Math.max(1, ...rows.flatMap((row) => [row.value, row.other ?? 0]));
  return (
    <div className="admin-bars">
      {rows.map((row) => (
        <div key={row.label} className="admin-bar" title={`${row.label}: ${row.value}${row.other !== undefined ? ` / ${row.other}` : ""}`}>
          <i style={{ height: `${Math.max(2, (row.value / max) * 100)}%` }} />
          {row.other !== undefined && <b style={{ height: `${Math.max(2, (row.other / max) * 100)}%` }} />}
          <span>{row.label}</span>
        </div>
      ))}
    </div>
  );
}
