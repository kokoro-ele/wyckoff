import { lazy, Suspense, useEffect, useState } from "react";
import { ListChecks, Search, Settings2, Sparkles, UserRound } from "lucide-react";
import { useWorkbench } from "./store.js";
import { WatchlistSidebar } from "./components/WatchlistSidebar.js";
import { ChartPanel } from "./components/ChartPanel.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { SearchModal } from "./components/SearchModal.js";
import { Toast } from "./components/Toast.js";
import { AccountPanel } from "./components/AccountPanel.js";
import { useAuth } from "./auth/AuthProvider.js";
import { useI18n } from "./i18n.js";

const MembershipPanel = lazy(() => import("./components/MembershipPanel.js").then((m) => ({ default: m.MembershipPanel })));
const SettingsPanel = lazy(() => import("./components/SettingsPanel.js").then((m) => ({ default: m.SettingsPanel })));

export function App() {
  const { t } = useI18n();
  const { isPending, isVerified } = useAuth();
  const [membershipOpen, setMembershipOpen] = useState(() => new URLSearchParams(window.location.search).has("billing"));
  const [accountOpen, setAccountOpen] = useState(() => new URLSearchParams(window.location.search).has("account"));
  const [watchOpen, setWatchOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(() => window.innerWidth >= 1100);
  const setSearchOpen = useWorkbench((s) => s.setSearchOpen);
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
    <div className="app-shell canvas-workbench flex h-full min-h-0 w-full flex-col overflow-hidden text-ink">
      <div className="app-stage canvas-stage relative flex min-h-0 min-w-0 flex-1 overflow-hidden p-2">
        <nav className="app-rail" aria-label={t("app.name")}>
          <div className="rail-brand" aria-hidden="true">W</div>
          <button
            type="button"
            className="rail-btn"
            aria-label={t("action.search")}
            title={`${t("action.search")} ⌘K`}
            onClick={() => setSearchOpen(true)}
          >
            <Search size={19} />
          </button>
          <button
            type="button"
            className="rail-btn"
            aria-label={t("action.watchlist")}
            aria-pressed={watchOpen}
            title={t("action.watchlist")}
            onClick={() => setWatchOpen((value) => !value)}
          >
            <ListChecks size={19} />
          </button>
          <button
            type="button"
            className="rail-btn"
            aria-label={t("action.analysis")}
            aria-pressed={chatOpen}
            title={t("action.analysis")}
            onClick={() => setChatOpen((value) => !value)}
          >
            <Sparkles size={19} />
          </button>
          <div className="rail-spacer" />
          <button
            type="button"
            className="rail-btn rail-account"
            aria-label={t("action.account")}
            aria-pressed={accountOpen}
            title={t("action.account")}
            onClick={() => setAccountOpen(true)}
          >
            <UserRound size={19} />
            {!isVerified && <span className="rail-dot" aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="rail-btn"
            aria-label={t("action.settings")}
            title={t("action.settings")}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 size={19} />
          </button>
        </nav>

        <div className="canvas-main flex min-h-0 min-w-0 flex-1">
          <ChartPanel />
        </div>
        <div className="canvas-dock canvas-dock-left" hidden={!watchOpen}>
          <WatchlistSidebar />
        </div>
        <div className="canvas-dock canvas-dock-right" hidden={!chatOpen}>
          <ChatPanel />
        </div>
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
