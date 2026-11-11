import { lazy, Suspense, useEffect, useState } from "react";
import { useWorkbench } from "./store.js";
import { WatchlistSidebar } from "./components/WatchlistSidebar.js";
import { ChartPanel } from "./components/ChartPanel.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { SearchModal } from "./components/SearchModal.js";
import { Toast } from "./components/Toast.js";
import { AccountPanel } from "./components/AccountPanel.js";
import { useAuth } from "./auth/AuthProvider.js";

const MembershipPanel = lazy(() => import("./components/MembershipPanel.js").then((m) => ({ default: m.MembershipPanel })));
const SettingsPanel = lazy(() => import("./components/SettingsPanel.js").then((m) => ({ default: m.SettingsPanel })));

export function App() {
  const { isPending, isVerified } = useAuth();
  const [membershipOpen, setMembershipOpen] = useState(() => new URLSearchParams(window.location.search).has("billing"));
  const [accountOpen, setAccountOpen] = useState(() => new URLSearchParams(window.location.search).has("account"));
  const bootstrap = useWorkbench((s) => s.bootstrap);
  const clearPersonalData = useWorkbench((s) => s.clearPersonalData);
  const settingsOpen = useWorkbench((s) => s.settingsOpen);
  const setSettingsOpen = useWorkbench((s) => s.setSettingsOpen);

  useEffect(() => {
    if (isPending) return;
    if (!isVerified) clearPersonalData();
    void bootstrap(isVerified);
  }, [bootstrap, clearPersonalData, isPending, isVerified]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("settings")) setSettingsOpen(true);
  }, [setSettingsOpen]);

  useEffect(() => {
    const openTopUp = () => setMembershipOpen(true);
    window.addEventListener("credits:exhausted", openTopUp);
    return () => window.removeEventListener("credits:exhausted", openTopUp);
  }, []);

  return (
    <div className="app-shell flex h-full min-h-0 w-full overflow-hidden p-3 text-ink">
      <div className="app-stage relative z-10 flex min-h-0 min-w-0 flex-1 gap-3">
        <WatchlistSidebar
          onOpenAccount={() => setAccountOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <ChartPanel />
        <ChatPanel />
      </div>

      <SearchModal />
      <Toast />
      {accountOpen && (
        <AccountPanel
          onClose={() => setAccountOpen(false)}
          onOpenTopUp={() => {
            setAccountOpen(false);
            setMembershipOpen(true);
          }}
        />
      )}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsPanel onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
      {membershipOpen && (
        <Suspense fallback={null}>
          <MembershipPanel onClose={() => setMembershipOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
