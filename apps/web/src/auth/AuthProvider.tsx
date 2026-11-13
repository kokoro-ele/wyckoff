import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { authClient } from "../lib/auth.js";
import { AuthDialog } from "./AuthDialog.js";

interface AuthValue {
  session: ReturnType<typeof authClient.useSession>["data"];
  isPending: boolean;
  isVerified: boolean;
  requireAuth: (action: () => void) => void;
  openAuth: (mode?: "login" | "register") => void;
  closeAuth: () => void;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending, refetch } = authClient.useSession();
  const initialAuthMode = (() => {
    const requested = new URLSearchParams(window.location.search).get("auth");
    return requested === "register" ? "register" as const : "login" as const;
  })();
  const [dialogOpen, setDialogOpen] = useState(() => new URLSearchParams(window.location.search).has("auth"));
  const [requestedMode, setRequestedMode] = useState<"login" | "register">(initialAuthMode);
  const pending = useRef<(() => void) | null>(null);
  const isVerified = Boolean(session?.user.emailVerified);

  const openAuth = useCallback((mode: "login" | "register" = "login") => {
    setRequestedMode(mode);
    setDialogOpen(true);
  }, []);
  const closeAuth = useCallback(() => {
    pending.current = null;
    setRequestedMode("login");
    try {
      // Closing the auth dialog cancels the mobile start-flow handoff too.
      localStorage.removeItem("wyckoff:pendingStart");
    } catch { /* storage may be disabled in private webviews */ }
    setDialogOpen(false);
  }, []);

  const requireAuth = useCallback(
    (action: () => void) => {
      if (isVerified) action();
      else {
        pending.current = action;
        setDialogOpen(true);
      }
    },
    [isVerified],
  );

  useEffect(() => {
    const open = () => setDialogOpen(true);
    window.addEventListener("auth:required", open);
    return () => window.removeEventListener("auth:required", open);
  }, []);

  useEffect(() => {
    if (!isVerified || !dialogOpen) return;
    const action = pending.current;
    pending.current = null;
    setDialogOpen(false);
    if (action) action();
  }, [dialogOpen, isVerified]);

  return (
    <AuthContext.Provider value={{ session, isPending, isVerified, requireAuth, openAuth, closeAuth }}>
      {children}
      <AuthDialog open={dialogOpen} requestedMode={requestedMode} onClose={closeAuth} onVerified={() => void refetch()} />
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
