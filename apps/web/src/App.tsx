import { lazy, Suspense, useEffect, useState } from "react";
import { useWorkbench } from "./store.js";
import { WatchlistSidebar } from "./components/WatchlistSidebar.js";
import { ChartPanel } from "./components/ChartPanel.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { SearchModal } from "./components/SearchModal.js";
import { Toast } from "./components/Toast.js";
import { PanelLeft, PanelRight, Search, Crown, Settings2 } from "lucide-react";
import { CanvasSurface } from "./components/CanvasSurface.js";
const MembershipPanel = lazy(() => import("./components/MembershipPanel.js").then(m => ({ default: m.MembershipPanel })));

const SettingsPanel = lazy(() => import("./components/SettingsPanel.js").then(m => ({ default: m.SettingsPanel })));

export function App() {
  const [membershipOpen, setMembershipOpen] = useState(() => new URLSearchParams(window.location.search).has("billing"));
  const [watchOpen, setWatchOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(() => window.innerWidth >= 1200);
  const setSearchOpen = useWorkbench(s => s.setSearchOpen);
  const bootstrap = useWorkbench((s) => s.bootstrap);
  const settingsOpen = useWorkbench((s) => s.settingsOpen);
  const setSettingsOpen = useWorkbench((s) => s.setSettingsOpen);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const openTopUp = () => setMembershipOpen(true);
    window.addEventListener("credits:exhausted", openTopUp);
    return () => window.removeEventListener("credits:exhausted", openTopUp);
  }, []);

  return (
    <div className="app-shell canvas-workbench flex h-full min-h-0 w-full flex-col overflow-hidden text-ink">
      <header className="canvas-topbar flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <CanvasSurface compact className="canvas-brand"><span className="font-semibold tracking-wide"><span className="text-accent">W</span> <span className="hidden sm:inline">WYCKOFF</span></span></CanvasSurface>
        <button className="canvas-action" aria-label="显示自选面板" aria-pressed={watchOpen} onClick={() => setWatchOpen(v => !v)}><PanelLeft size={16} /><span>自选</span></button>
        <button className="canvas-action" onClick={() => setSearchOpen(true)}><Search size={16} /><span>搜索</span><kbd className="hidden text-ink-faint md:inline">⌘ K</kbd></button>
        <div className="min-w-0 flex-1" />
        <button className="canvas-action" onClick={() => setMembershipOpen(true)}><Crown size={16} /><span>充值</span></button>
        <button className="canvas-action" aria-label="设置" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /><span>设置</span></button>
        <button className="canvas-action" aria-label="显示 AI 研究面板" aria-pressed={chatOpen} onClick={() => setChatOpen(v => !v)}><PanelRight size={16} /><span>分析</span></button>
      </header>
      <div className="app-stage canvas-stage relative flex min-h-0 min-w-0 flex-1 overflow-hidden p-2">
        <div className="canvas-main flex min-h-0 min-w-0 flex-1"><ChartPanel /></div>
        <div className="canvas-dock canvas-dock-left" hidden={!watchOpen}><WatchlistSidebar /></div>
        <div className="canvas-dock canvas-dock-right" hidden={!chatOpen}><ChatPanel /></div>
      </div>
      <SearchModal />
      {settingsOpen ? (
        <Suspense fallback={null}>
          <SettingsPanel onClose={() => setSettingsOpen(false)} />
        </Suspense>
      ) : null}
      <Toast />
      {membershipOpen && <Suspense fallback={null}><MembershipPanel onClose={() => setMembershipOpen(false)} /></Suspense>}
    </div>
  );
}
