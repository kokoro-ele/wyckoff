import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
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

afterEach(() => {
  window.innerWidth = 1400;
});

it("leaves the chart unobstructed when opened on a phone", () => {
  window.innerWidth = 390;
  const html = renderToStaticMarkup(<I18nProvider><App /></I18nProvider>);
  expect(html).toMatch(/aria-label="自选"[^>]*aria-pressed="false"/);
  expect(html).toMatch(/aria-label="Agent 分析"[^>]*aria-pressed="false"/);
  expect(html).toMatch(/class="canvas-dock canvas-dock-left"[^>]*hidden/);
  expect(html).toMatch(/class="canvas-dock canvas-dock-right"[^>]*hidden/);
});

it("keeps both desktop docks open on a wide screen", () => {
  const html = renderToStaticMarkup(<I18nProvider><App /></I18nProvider>);
  expect(html).toMatch(/aria-label="自选"[^>]*aria-pressed="true"/);
  expect(html).toMatch(/aria-label="Agent 分析"[^>]*aria-pressed="true"/);
});

it("keeps the five workbench actions in the top bar", () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <App />
    </I18nProvider>,
  );
  const header = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)?.[1] ?? "";
  const labels = [...header.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)]
    .map((match) => match[1].match(/<span>(.*?)<\/span>/)?.[1])
    .filter(Boolean);
  expect(labels).toEqual(["自选", "搜索", "Agent 分析", "账户", "设置"]);
});
