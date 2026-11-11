import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.hoisted(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  vi.stubGlobal("navigator", { language: "zh-CN" });
  vi.stubGlobal("window", { location: { search: "" }, innerWidth: 1400, localStorage: { getItem: () => null, setItem: () => {} } });
});
vi.mock("./components/WatchlistSidebar.js", () => ({ WatchlistSidebar: () => null }));
vi.mock("./components/ChartPanel.js", () => ({ ChartPanel: () => null }));
vi.mock("./components/ChatPanel.js", () => ({ ChatPanel: () => null }));
vi.mock("./components/SearchModal.js", () => ({ SearchModal: () => null }));
vi.mock("./components/Toast.js", () => ({ Toast: () => null }));
vi.mock("./lib/auth.js", () => ({
  authClient: {
    useSession: () => ({ data: null, isPending: false, refetch: vi.fn() }),
    signOut: vi.fn(),
  },
  prepareReferral: vi.fn(),
}));
vi.mock("./auth/AuthProvider.js", () => ({
  useAuth: () => ({
    session: null,
    isPending: false,
    isVerified: false,
    requireAuth: vi.fn(),
    openAuth: vi.fn(),
    closeAuth: vi.fn(),
  }),
}));
import { App } from "./App.js";
import { I18nProvider } from "./i18n.js";

it("exposes the five workbench rail actions", () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
  const nav = html.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? "";
  const labels = [...nav.matchAll(/aria-label="([^"]+)"/g)].map((match) => match[1]);
  expect(labels).toEqual(["搜索", "自选", "分析", "账户", "设置"]);
});
