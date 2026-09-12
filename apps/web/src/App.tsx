import { lazy, Suspense, useEffect } from "react";
import { useWorkbench } from "./store.js";
import { WatchlistSidebar } from "./components/WatchlistSidebar.js";
import { ChartPanel } from "./components/ChartPanel.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { SearchModal } from "./components/SearchModal.js";
import { RecommendPanel } from "./components/RecommendPanel.js";
import { Toast } from "./components/Toast.js";

const AiWyckoffBacktestPanel = lazy(() =>
  import("./components/AiWyckoffBacktestPanel.js").then((module) => ({ default: module.AiWyckoffBacktestPanel })),
);
const KeySettingsPanel = lazy(() =>
  import("./components/KeySettingsPanel.js").then((module) => ({ default: module.KeySettingsPanel })),
);

export function App() {
  const bootstrap = useWorkbench((s) => s.bootstrap);
  const backtestOpen = useWorkbench((s) => s.backtestOpen);
  const setBacktestOpen = useWorkbench((s) => s.setBacktestOpen);
  const symbol = useWorkbench((s) => s.symbol);
  const adjust = useWorkbench((s) => s.adjust);
  const settingsOpen = useWorkbench((s) => s.settingsOpen);
  const setSettingsOpen = useWorkbench((s) => s.setSettingsOpen);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return (
    <div className="app-shell flex h-full min-h-0 w-full overflow-hidden p-3 text-ink">
      <div className="ambient-orb ambient-orb-blue" />
      <div className="ambient-orb ambient-orb-mint" />
      <div className="app-stage relative z-10 flex min-h-0 min-w-0 flex-1 gap-3">
        <WatchlistSidebar />
        <ChartPanel />
        <ChatPanel />
      </div>
      <SearchModal />
      <RecommendPanel />
      <Suspense fallback={null}>
        <AiWyckoffBacktestPanel
          open={backtestOpen}
          onClose={() => setBacktestOpen(false)}
          symbol={symbol}
          adjust={adjust}
        />
      </Suspense>
      {settingsOpen ? (
        <Suspense fallback={null}>
          <KeySettingsPanel onClose={() => setSettingsOpen(false)} />
        </Suspense>
      ) : null}
      <Toast />
    </div>
  );
}
