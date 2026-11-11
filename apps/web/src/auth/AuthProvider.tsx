import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { authClient } from "../lib/auth.js";
import { AuthDialog } from "./AuthDialog.js";

interface AuthValue {
  session: ReturnType<typeof authClient.useSession>["data"];
  isPending: boolean;
  isVerified: boolean;
  requireAuth: (action: () => void) => void;
  openAuth: () => void;
  closeAuth: () => void;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, isPending, refetch } = authClient.useSession();
  const [dialogOpen, setDialogOpen] = useState(() => new URLSearchParams(window.location.search).has("auth"));
  const pending = useRef<(() => void) | null>(null);
  const isVerified = Boolean(session?.user.emailVerified);

  const openAuth = useCallback(() => setDialogOpen(true), []);
  const closeAuth = useCallback(() => {
    pending.current = null;
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
      <AuthDialog open={dialogOpen} onClose={closeAuth} onVerified={() => void refetch()} />
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
