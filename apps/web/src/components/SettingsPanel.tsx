import { useEffect, useRef, useState } from "react";
import { X, LogOut } from "lucide-react";
import { ThemeSelector } from "../theme.js";
import { authClient } from "../lib/auth.js";
import { EffectsToggle } from "./CanvasSurface.js";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { data: session } = authClient.useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const el = dialog.current; el?.showModal(); return () => el?.close(); }, []);
  const logout = async () => {
    setBusy(true); setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message || "退出失败，请重试");
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "退出失败，请重试"); setBusy(false); }
  };
  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="settings-title" className="m-auto w-[min(460px,94vw)] rounded-2xl border border-line bg-panel p-6 text-ink shadow-2xl backdrop:bg-black/50">
    <div className="flex items-center justify-between"><h2 id="settings-title" className="text-xl font-semibold">设置</h2><button aria-label="关闭设置" onClick={onClose} className="rounded p-2"><X size={20} /></button></div>
    <div className="mt-6 flex items-center justify-between gap-3"><span className="text-sm">界面主题</span><ThemeSelector /></div>
    <div className="mt-4 flex items-center justify-between gap-3"><span className="text-sm">纸面动效</span><EffectsToggle /></div>
    <section className="mt-6 border-t border-line pt-5"><h3 className="text-sm font-medium">账号</h3><p className="mt-2 break-all text-sm text-ink-muted">{session?.user.email ?? "正在读取账号…"}</p><p className="mt-1 text-xs text-ink-muted">{session?.user.emailVerified ? "邮箱已验证" : "邮箱待验证"}</p><button disabled={busy} onClick={() => void logout()} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50"><LogOut size={14} />{busy ? "正在退出…" : "退出登录"}</button></section>
    {error && <p role="alert" className="mt-4 text-sm text-warn">{error}</p>}
  </dialog>;
}
