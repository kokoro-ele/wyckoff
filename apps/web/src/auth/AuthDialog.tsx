import { useEffect, useState, type FormEvent } from "react";
import { Sparkles, X } from "lucide-react";
import { authClient, prepareReferral } from "../lib/auth.js";
import { useI18n } from "../i18n.js";

type Mode = "login" | "register" | "verify" | "forgot" | "reset";

interface Providers {
  ready: boolean;
  email: boolean;
  google: boolean;
}

export function AuthDialog({
  open,
  onClose,
  onVerified,
}: {
  open: boolean;
  onClose: () => void;
  onVerified: () => void;
}) {
  const { t } = useI18n();
  const session = authClient.useSession();
  const [providers, setProviders] = useState<Providers | null>(null);
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [inviteCode, setInviteCode] = useState(() =>
    new URLSearchParams(window.location.search).get("invite")?.trim() ?? "",
  );

  useEffect(() => {
    void fetch("/api/auth/providers")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("providers"))))
      .then((value: Providers) => setProviders(value))
      .catch(() => setProviders({ ready: false, email: false, google: false }));
  }, []);

  const sessionUserId = session.data?.user.id;
  const sessionVerified = session.data?.user.emailVerified;
  useEffect(() => {
    if (!open) return;
    const user = session.data?.user;
    setMessage("");
    setOtp("");
    setPassword("");
    setBusy(false);
    if (user && !user.emailVerified) {
      setMode("verify");
      setEmail(user.email);
    } else if (!user) {
      const requested = new URLSearchParams(window.location.search).get("auth");
      setMode(requested === "register" ? "register" : "login");
    }
    // Depend on scalar session identity; the hook may return a new user object
    // on unrelated renders, and resetting a half-typed form is unacceptable.
  }, [open, sessionUserId, sessionVerified]);

  if (!open) return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("error.NETWORK"));
    } finally {
      setBusy(false);
    }
  };

  function check(result: { error?: { message?: string; code?: string; status?: number } | null }) {
    if (!result.error) return;
    if (result.error.status === 429 || result.error.code === "TOO_MANY_REQUESTS") {
      throw new Error(t("auth.tooMany"));
    }
    if (result.error.code === "TOO_MANY_ATTEMPTS") {
      throw new Error(t("auth.tooManyAttempts"));
    }
    if (result.error.code === "INVALID_OTP") {
      throw new Error(t("auth.invalidCode"));
    }
    throw new Error(result.error.message || t("error.NETWORK"));
  }

  const sendCode = async (to: string) => {
    check(
      await authClient.emailOtp.sendVerificationOtp({
        email: to,
        type: "email-verification",
      }),
    );
    setResendAt(Date.now() + 60_000);
    setMessage(t("auth.sentCode"));
  };

  const resend = async () => {
    if (Date.now() < resendAt) throw new Error(t("auth.resendWait"));
    await sendCode(session.data?.user.email || email);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (mode === "register") {
        if (inviteCode.trim()) await prepareReferral(inviteCode.trim());
        check(
          await authClient.signUp.email({
            email,
            password,
            name: name.trim() || email.split("@")[0] || "Reader",
          }),
        );
        setMode("verify");
        setPassword("");
        await sendCode(email);
      } else if (mode === "verify") {
        check(
          await authClient.emailOtp.verifyEmail({
            email: session.data?.user.email || email,
            otp,
          }),
        );
        setMessage(t("auth.verified"));
        onVerified();
      } else if (mode === "forgot") {
        check(await authClient.emailOtp.requestPasswordReset({ email }));
        setMode("reset");
        setMessage(t("auth.resetSent"));
      } else if (mode === "reset") {
        check(await authClient.emailOtp.resetPassword({ email, otp, password }));
        setMode("login");
        setPassword("");
        setOtp("");
        setMessage(t("auth.resetDone"));
      } else {
        const result = await authClient.signIn.email({ email, password });
        if (result.error?.code === "EMAIL_NOT_VERIFIED") {
          setMode("verify");
          await sendCode(email);
          return;
        }
        check(result);
        setPassword("");
        onVerified();
      }
    });
  };

  const title = {
    login: t("auth.title.login"),
    register: t("auth.title.register"),
    verify: t("auth.title.verify"),
    forgot: t("auth.title.forgot"),
    reset: t("auth.title.reset"),
  }[mode];
  const verifying = mode === "verify";
  const canSubmit = Boolean(
    providers?.ready &&
      providers.email &&
      (verifying
        ? otp.length === 6
        : mode === "reset"
          ? otp.length === 6 && password.length >= 12
          : mode === "forgot"
            ? email
            : email && password.length >= 12),
  );

  return (
    <div
      className="auth-backdrop mobile-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center bg-ink/35 px-4 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        className="auth-card hand-card w-full max-w-[400px] p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="hand-eyebrow">WYCKOFF · ACCOUNT</div>
            <h2 id="auth-title" className="mt-1 text-[22px] font-semibold leading-tight">
              {title}
            </h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-dim">{t("auth.subtitle")}</p>
          </div>
          <button type="button" aria-label={t("action.close")} className="hand-icon" onClick={onClose} disabled={busy}>
            <X size={17} />
          </button>
        </div>

        {!providers ? (
          <p className="mt-6 text-sm text-ink-dim">{t("action.loading")}</p>
        ) : !providers.ready ? (
          <div className="mt-5 rounded-xl border border-line bg-panel-2/60 p-3 text-sm">
            <p className="font-semibold">{t("auth.unavailable")}</p>
            <p className="mt-1 text-xs text-ink-dim">{t("auth.unavailableHint")}</p>
          </div>
        ) : (
          <>
            {(mode === "login" || mode === "register") && providers.google && (
              <button
                type="button"
                disabled={busy}
                className="hand-btn mt-4 flex w-full items-center justify-center gap-2 px-3 py-2.5 text-sm"
                onClick={() =>
                  void run(async () => {
                    if (inviteCode.trim()) await prepareReferral(inviteCode.trim());
                    check(await authClient.signIn.social({ provider: "google", callbackURL: `${window.location.origin}/app` }));
                  })
                }
              >
                <Sparkles size={15} />
                {t("auth.google")}
              </button>
            )}

            {providers.email ? (
              <form className="mt-4 space-y-3" onSubmit={submit}>
                {mode === "register" && (
                  <label className="hand-label">
                    {t("auth.name")}
                    <input
                      className="hand-input"
                      maxLength={100}
                      autoComplete="name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder={t("common.optional")}
                    />
                  </label>
                )}
                {mode === "register" && (
                  <label className="hand-label">
                    {t("auth.inviteCode")}
                    <input
                      className="hand-input font-mono text-[11px]"
                      maxLength={100}
                      autoComplete="off"
                      value={inviteCode}
                      onChange={(event) => setInviteCode(event.target.value)}
                      placeholder={t("auth.inviteCodePlaceholder")}
                      spellCheck={false}
                    />
                  </label>
                )}
                <label className="hand-label">
                  {t("auth.email")}
                  <input
                    className="hand-input"
                    required
                    type="email"
                    autoComplete="email"
                    disabled={Boolean(session.data?.user)}
                    value={session.data?.user.email || email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                {(verifying || mode === "reset") && (
                  <label className="hand-label">
                    {t("auth.code")}
                    <input
                      className="hand-input tracking-[0.35em]"
                      required
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      autoComplete="one-time-code"
                      value={otp}
                      onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
                    />
                  </label>
                )}
                {!verifying && mode !== "forgot" && (
                  <label className="hand-label">
                    {mode === "reset" ? t("auth.newPassword") : t("auth.password")}
                    <input
                      className="hand-input"
                      required
                      type="password"
                      minLength={12}
                      maxLength={128}
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </label>
                )}
                {mode === "register" && <p className="text-[11px] text-ink-faint">{t("auth.passwordHint")}</p>}
                {mode === "register" && inviteCode.trim() && (
                  <p className="rounded-lg border border-accent/30 bg-accent-soft px-2.5 py-1.5 text-[11px] text-accent">
                    {t("auth.inviteHint")}
                  </p>
                )}

                <button type="submit" disabled={busy || !canSubmit} className="hand-btn hand-btn-primary w-full px-3 py-2.5 text-sm">
                  {busy
                    ? t("action.loading")
                    : mode === "register"
                      ? t("auth.signUp")
                      : mode === "verify"
                        ? t("auth.verify")
                        : mode === "forgot"
                          ? t("auth.sendReset")
                          : mode === "reset"
                            ? t("auth.reset")
                            : t("auth.signIn")}
                </button>
                {verifying && (
                  <button type="button" disabled={busy} className="hand-link w-full text-center text-xs" onClick={() => void run(resend)}>
                    {t("auth.resend")}
                  </button>
                )}
              </form>
            ) : (
              <p className="mt-4 text-sm text-ink-dim">{t("auth.emailUnavailable")}</p>
            )}

            {message && <p role="alert" className="mt-3 rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-2 text-xs text-warn">{message}</p>}

            <div className="mt-4 flex items-center justify-between gap-2 text-xs">
              {mode === "login" && (
                <>
                  <button type="button" className="hand-link" onClick={() => setMode("register")}>
                    {t("auth.noAccount")}
                  </button>
                  <button type="button" className="hand-link text-ink-faint" onClick={() => setMode("forgot")}>
                    {t("auth.forgot")}
                  </button>
                </>
              )}
              {mode === "register" && (
                <button type="button" className="hand-link" onClick={() => setMode("login")}>
                  {t("auth.hasAccount")}
                </button>
              )}
              {(mode === "forgot" || mode === "reset") && (
                <button type="button" className="hand-link" onClick={() => setMode("login")}>
                  {t("auth.hasAccount")}
                </button>
              )}
              {mode === "verify" && (
                <button type="button" className="hand-link text-ink-faint" onClick={onClose}>
                  {t("action.cancel")}
                </button>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
