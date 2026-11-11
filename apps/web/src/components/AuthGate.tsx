import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { authClient, prepareReferral } from "../lib/auth.js";
import { CanvasSurface, MarketArtwork } from "./CanvasSurface.js";

type Mode = "login" | "register" | "verify" | "forgot" | "reset";
export function AuthGate({ children }: { children: ReactNode }) {
  const { data: session, isPending, refetch } = authClient.useSession();
  const [providers, setProviders] = useState<{ ready: boolean; email: boolean; google: boolean } | null>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [invite, setInvite] = useState(() => new URLSearchParams(window.location.search).get("invite") ?? "");
  const [resendAt, setResendAt] = useState(0);
  useEffect(() => { void fetch("/api/auth/providers").then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(setProviders).catch(() => setProviders({ ready: false, email: false, google: false })); }, []);
  async function run(action: () => Promise<void>) { setBusy(true); setMessage(""); try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : "暂时无法连接服务器，请稍后重试。"); } finally { setBusy(false); } }
  function check(result: { error?: { message?: string } | null }) { if (result.error) throw new Error(result.error.message || "操作失败，请稍后重试。"); }
  async function resend() {
    if (Date.now() < resendAt) throw new Error("请稍候一分钟再重新发送。");
    check(await authClient.emailOtp.sendVerificationOtp({ email: session?.user.email || email, type: "email-verification" }));
    setResendAt(Date.now() + 60_000); setMessage("验证码已发送，请检查邮箱。");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      if (mode === "register") {
        await prepareReferral(invite);
        check(await authClient.signUp.email({ email, password, name }));
        setMode("verify"); setPassword(""); setResendAt(Date.now() + 60_000); setMessage("请查收邮箱中的六位验证码。");
      } else if (mode === "verify" || (session && !session.user.emailVerified)) {
        check(await authClient.emailOtp.verifyEmail({ email: session?.user.email || email, otp }));
        await refetch(); setMode("login"); setMessage("邮箱验证成功，请登录。");
      } else if (mode === "forgot") {
        check(await authClient.emailOtp.requestPasswordReset({ email })); setMode("reset"); setMessage("如果邮箱已注册，重置验证码将发送至邮箱。");
      } else if (mode === "reset") {
        check(await authClient.emailOtp.resetPassword({ email, otp, password })); setPassword(""); setMode("login"); setMessage("密码已重置，请登录。");
      } else {
        const result = await authClient.signIn.email({ email, password });
        if (result.error?.code === "EMAIL_NOT_VERIFIED") { setMode("verify"); setMessage("请验证邮箱后登录；可重新发送验证码。"); return; }
        check(result); setPassword(""); await refetch();
      }
    });
  }
  if (isPending || !providers) return <main className="auth-page"><p role="status">正在连接登录服务…</p></main>;
  if (!providers.ready) return <main className="auth-page"><section className="auth-card"><h1>登录服务尚未就绪</h1><p>运营方需要配置数据库、认证密钥和站点地址。</p><button onClick={() => window.location.reload()}>重新连接</button></section></main>;
  if (session?.user.emailVerified) return <div className="authenticated-workspace">{children}<div className="account-menu"><span title={session.user.email}>{session.user.name || session.user.email}</span><button onClick={() => void run(async () => { check(await authClient.signOut()); window.location.reload(); })}>退出登录</button></div></div>;
  const verifying = mode === "verify" || Boolean(session);
  const title = verifying ? "验证邮箱" : ({ login: "登录你的分析工作区", register: "创建你的分析工作区", forgot: "找回密码", reset: "设置新密码", verify: "验证邮箱" })[mode];
  return <main className="auth-page"><section className="auth-card">
    <CanvasSurface className="canvas-auth-hero"><MarketArtwork /><div className="canvas-hero-copy"><span>PRICE · VOLUME · STRUCTURE</span><strong>看见价格背后的结构</strong></div></CanvasSurface>
    <div className="auth-brand">WYCKOFF WORKBENCH</div><h1>{title}</h1><p>自选、分析会话与图表标注，随账号云端保存。</p>
    {!verifying && (mode === "login" || mode === "register") && <>
      <label>邀请码（可选，仅新用户有效）<input maxLength={100} value={invite} onChange={event => setInvite(event.target.value)} /></label>
      <button disabled={busy || !providers.google} onClick={() => void run(async () => { await prepareReferral(invite); check(await authClient.signIn.social({ provider: "google", callbackURL: window.location.origin })); })}>{providers.google ? "使用 Google 登录 / 注册" : "Google 登录尚未配置"}</button>
    </>}
    {providers.email ? <form onSubmit={event => void submit(event)}>
      {mode === "register" && <label>昵称<input required maxLength={100} autoComplete="name" value={name} onChange={event => setName(event.target.value)} /></label>}
      <label>邮箱<input required type="email" autoComplete="email" disabled={Boolean(session)} value={session?.user.email || email} onChange={event => setEmail(event.target.value)} /></label>
      {(verifying || mode === "reset") && <label>六位验证码<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={otp} onChange={event => setOtp(event.target.value)} /></label>}
      {!verifying && mode !== "forgot" && <label>{mode === "reset" ? "新密码" : "密码"}<input required type="password" minLength={12} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={event => setPassword(event.target.value)} /></label>}
      {mode === "register" && <small>密码至少 12 个字符；完成邮箱验证后进入工作区。</small>}
      <button type="submit" disabled={busy}>{busy ? "正在处理…" : verifying ? "验证邮箱" : mode === "register" ? "注册并发送验证码" : mode === "forgot" ? "发送重置验证码" : mode === "reset" ? "重置密码" : "登录"}</button>
      {verifying && <button type="button" disabled={busy} onClick={() => void run(resend)}>重新发送验证码</button>}
    </form> : <p>邮箱注册与密码找回尚未配置，请使用可用的登录方式。</p>}
    {message && <p role="alert" className="auth-error">{message}</p>}
    {!session && <><button className="auth-switch" disabled={busy} onClick={() => { setMode(mode === "login" ? "register" : "login"); setMessage(""); setPassword(""); }}>{mode === "login" ? "没有账号？创建账号" : "返回登录"}</button>{mode === "login" && <button disabled={busy || !providers.email} onClick={() => setMode("forgot")}>忘记密码</button>}</>}
    {session && <button onClick={() => void run(async () => { check(await authClient.signOut()); await refetch(); })}>退出登录</button>}
  </section></main>;
}
