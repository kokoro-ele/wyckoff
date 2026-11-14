import { useEffect, useState } from "react";
import { LineChart, PanelLeft, PanelRight, Search, Settings2, Star, UserRound, X } from "lucide-react";
import { useWorkbench } from "./store.js";
import { WatchlistSidebar } from "./components/WatchlistSidebar.js";
import { MarketSidebar } from "./components/MarketSidebar.js";
import { ChartPanel } from "./components/ChartPanel.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { SearchModal } from "./components/SearchModal.js";
import { Toast } from "./components/Toast.js";
import { OnboardingModal } from "./components/OnboardingModal.js";
import { AccountPanel } from "./components/AccountPanel.js";
import { MembershipPanel } from "./components/MembershipPanel.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { StartAnalysisSheet } from "./components/StartAnalysisSheet.js";
import { DailyRewardDialog } from "./components/DailyRewardDialog.js";
import { trackXRegistration } from "./lib/xPixel.js";
import { useAuth } from "./auth/AuthProvider.js";
import { useI18n } from "./i18n.js";
import { useSeo } from "./lib/seo.js";
import { cn } from "./lib/utils.js";
import * as api from "./lib/api.js";

export function App() {
  const { t } = useI18n();
  const { session, isPending, isVerified, openAuth } = useAuth();
  useSeo({
    title: "Wyckoff 研究工作台 · EasyWyckoff",
    description: "Wyckoff 研究工作台",
    path: "/app",
    lang: "zh",
    noindex: true,
  });
  const [membershipOpen, setMembershipOpen] = useState(() => new URLSearchParams(window.location.search).has("billing"));
  const [accountOpen, setAccountOpen] = useState(() => new URLSearchParams(window.location.search).has("account"));
  const [watchOpen, setWatchOpen] = useState(true);
  const [leftTab, setLeftTab] = useState<"watch" | "market">("watch");
  const [chatOpen, setChatOpen] = useState(() => window.innerWidth >= 1100);
  const [startOpen, setStartOpen] = useState(() => new URLSearchParams(window.location.search).has("start"));
  const [dailyReward, setDailyReward] = useState<{ amount: number; balance: number } | null>(null);
  // Keep desktop preferences separate when rotating/resizing a mobile viewport.
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [mobileDock, setMobileDock] = useState<"watch" | "chat" | null>(null);
  const watchVisible = isMobile ? mobileDock === "watch" : watchOpen;
  const chatVisible = isMobile ? mobileDock === "chat" : chatOpen;
  const symbol = useWorkbench((s) => s.symbol);
  const setSymbol = useWorkbench((s) => s.setSymbol);
  const setSearchOpen = useWorkbench((s) => s.setSearchOpen);
  const pendingAgentPrompt = useWorkbench((s) => s.pendingAgentPrompt);
  const chartReady = useWorkbench((s) => s.chartReady);
  const requestAgent = useWorkbench((s) => s.requestAgent);
  const dockTab = useWorkbench((s) => s.dockTab);
  const setDockTab = useWorkbench((s) => s.setDockTab);
  const bootstrap = useWorkbench((s) => s.bootstrap);
  const clearPersonalData = useWorkbench((s) => s.clearPersonalData);
  const settingsOpen = useWorkbench((s) => s.settingsOpen);
  const setSettingsOpen = useWorkbench((s) => s.setSettingsOpen);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => setMobileDock(null), [symbol]);

  useEffect(() => {
    if (!pendingAgentPrompt || !chartReady) return;
    setDockTab("agent");
    if (isMobile) setMobileDock("chat");
    else setChatOpen(true);
  }, [pendingAgentPrompt, chartReady, isMobile, setDockTab]);

  useEffect(() => {
    if (!isVerified) return;
    const pending = (() => {
      try { return localStorage.getItem("wyckoff:pendingStart"); } catch { return null; }
    })();
    if (!pending) return;
    try { localStorage.removeItem("wyckoff:pendingStart"); } catch { /* ignore */ }
    const parsed = JSON.parse(pending) as { symbol?: unknown; prompt?: unknown };
    if (typeof parsed.symbol !== "string" || typeof parsed.prompt !== "string") return;
    void (async () => {
      await setSymbol(parsed.symbol as string);
      requestAgent(parsed.prompt as string);
    })();
  }, [isVerified, setSymbol, requestAgent]);

  useEffect(() => {
    if (isPending) return;
    if (!isVerified) clearPersonalData();
    void bootstrap(isVerified);
  }, [bootstrap, clearPersonalData, isPending, isVerified]);

  useEffect(() => {
    if (isPending || !isVerified) return;
    // The landing CTA carries ?start=1 for anonymous visitors. A user who is
    // already signed in should land directly in the workbench, not see the
    // first-run stock picker again.
    setStartOpen(false);
    const url = new URL(window.location.href);
    if (url.searchParams.has("start")) {
      url.searchParams.delete("start");
      window.history.replaceState(null, "", url);
    }
  }, [isPending, isVerified]);

  useEffect(() => {
    if (!isVerified) return;
    let disposed = false;
    const claim = () => {
      void api.claimDailyLogin()
        .then((reward) => {
          if (!disposed && reward.granted) setDailyReward({ amount: reward.amount, balance: reward.balance });
        })
        .catch(() => undefined);
    };
    claim();
    const onVisible = () => {
      if (document.visibilityState === "visible") claim();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isVerified]);

  useEffect(() => {
    if (!isVerified || !session?.user) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("registered") !== "1") return;
    trackXRegistration(session.user.email);
    url.searchParams.delete("registered");
    const next = `${window.location.pathname}${url.search}${window.location.hash}`;
    window.history.replaceState(null, "", next);
  }, [isVerified, session?.user?.email]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("settings")) setSettingsOpen(true);
  }, [setSettingsOpen]);

  useEffect(() => {
    const openTopUp = () => setMembershipOpen(true);
    window.addEventListener("credits:exhausted", openTopUp);
    return () => window.removeEventListener("credits:exhausted", openTopUp);
  }, []);

  const closeStart = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("start");
    window.history.replaceState(null, "", url);
    setStartOpen(false);
  };

  const beginStartAnalysis = async (symbolToUse: string, name?: string | null, nameEn?: string | null) => {
    const prompt = t("chat.quick.windowPrompt");
    try {
      localStorage.setItem("wyckoff:pendingStart", JSON.stringify({ symbol: symbolToUse, prompt }));
    } catch { /* storage may be disabled in private webviews */ }
    await setSymbol(symbolToUse, name, nameEn);
    closeStart();
    if (isVerified) {
      try { localStorage.removeItem("wyckoff:pendingStart"); } catch { /* ignore */ }
      requestAgent(prompt);
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("auth", "register");
    window.history.replaceState(null, "", url);
    openAuth("register");
  };

  return (
    <div className="app-shell canvas-workbench flex h-full min-h-0 w-full flex-col overflow-hidden text-ink">
      <header className="canvas-topbar flex shrink-0 items-center gap-2 border-b-2 border-line bg-panel px-3 py-2">
        <a href="/" className="canvas-brand flex items-center justify-center gap-1" aria-label="EasyWyckoff home">
          <span className="text-accent">W</span>
          <span>WYCKOFF</span>
        </a>
        <button
          type="button"
          className="canvas-action"
          aria-label={t("action.watchlist")}
          aria-pressed={watchVisible}
          aria-controls="watchlist-dock"
          onClick={() => {
            setLeftTab("watch");
            if (isMobile) setMobileDock((value) => value === "watch" ? null : "watch");
            else setWatchOpen((value) => !value);
          }}
        >
          <PanelLeft size={16} />
          <span>{t("action.watchlist")}</span>
        </button>
        <button type="button" className="canvas-action" data-tour="search" onClick={() => setSearchOpen(true)}>
          <Search size={16} />
          <span>{t("action.search")}</span>
          <kbd className="hidden text-ink-faint md:inline">⌘ K</kbd>
        </button>
        <div className="min-w-0 flex-1" />
        <button
          type="button"
          className="canvas-action"
          data-tour="analysis"
          aria-label={t("action.analysis")}
          aria-pressed={chatVisible}
          aria-controls="analysis-dock"
          onClick={() => {
            if (isMobile) {
              if (mobileDock === "chat" && dockTab === "agent") setMobileDock(null);
              else {
                setDockTab("agent");
                setMobileDock("chat");
              }
            } else if (chatOpen && dockTab === "agent") {
              setChatOpen(false);
            } else {
              setDockTab("agent");
              setChatOpen(true);
            }
          }}
        >
          <PanelRight size={16} />
          <span>{t("action.analysis")}</span>
        </button>
        <button type="button" className="canvas-action account-action" aria-label={t("action.account")} onClick={() => setAccountOpen(true)}>
          <UserRound size={16} />
          <span>{t("action.account")}</span>
          {!isVerified && <span className="account-dot" aria-hidden="true" />}
        </button>
        <button type="button" className="canvas-action" data-tour="settings" aria-label={t("action.settings")} onClick={() => setSettingsOpen(true)}>
          <Settings2 size={16} />
          <span>{t("action.settings")}</span>
        </button>
      </header>

      <div className="app-stage canvas-stage relative flex min-h-0 min-w-0 flex-1 overflow-hidden p-2">
        <div className="canvas-main flex min-h-0 min-w-0 flex-1" inert={isMobile && mobileDock === "watch"}>
          <ChartPanel />
        </div>
        <div className="canvas-dock canvas-dock-left" id="watchlist-dock" hidden={!watchVisible}>
          <button type="button" className="mobile-dock-close" onClick={() => setMobileDock(null)}>
            <X size={16} />{t("action.close")}
          </button>
          <div className="left-sidebar-stack">
            <div className="left-sidebar-tabs" role="tablist" aria-label={t("market.title")}>
              <button type="button" role="tab" aria-selected={leftTab === "watch"} className={cn("left-sidebar-tab", leftTab === "watch" && "is-active")} onClick={() => setLeftTab("watch")}>
                <Star size={13} />
                {t("watch.title")}
              </button>
              <button type="button" role="tab" aria-selected={leftTab === "market"} className={cn("left-sidebar-tab", leftTab === "market" && "is-active")} onClick={() => setLeftTab("market")}>
                <LineChart size={13} />
                {t("market.title")}
              </button>
            </div>
            {leftTab === "market" ? (
              <MarketSidebar onSelect={isMobile ? () => setMobileDock(null) : undefined} />
            ) : (
              <WatchlistSidebar onSelect={isMobile ? () => setMobileDock(null) : undefined} />
            )}
          </div>
        </div>
        <div className="canvas-dock canvas-dock-right" id="analysis-dock" hidden={!chatVisible}>
          <button type="button" className="mobile-dock-close" onClick={() => setMobileDock(null)}>
            <X size={16} />{t("action.close")}
          </button>
          <ChatPanel onCloseDock={isMobile ? () => setMobileDock(null) : undefined} />
        </div>
      </div>

      <StartAnalysisSheet open={startOpen && !isPending && !isVerified} onClose={closeStart} onPick={(nextSymbol, name, nameEn) => void beginStartAnalysis(nextSymbol, name, nameEn)} />
      <DailyRewardDialog reward={dailyReward} onClose={() => setDailyReward(null)} />
      <SearchModal />
      <Toast />
      <OnboardingModal />
      {accountOpen && (
        <AccountPanel
          onClose={() => setAccountOpen(false)}
          onOpenTopUp={() => {
            setAccountOpen(false);
            setMembershipOpen(true);
          }}
        />
      )}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {membershipOpen && <MembershipPanel onClose={() => setMembershipOpen(false)} />}
    </div>
  );
}
