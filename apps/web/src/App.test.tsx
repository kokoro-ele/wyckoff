import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.hoisted(() => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  vi.stubGlobal("window", { location: { search: "" }, innerWidth: 1400 });
});
vi.mock("./components/WatchlistSidebar.js", () => ({ WatchlistSidebar: () => null }));
vi.mock("./components/ChartPanel.js", () => ({ ChartPanel: () => null }));
vi.mock("./components/ChatPanel.js", () => ({ ChatPanel: () => null }));
vi.mock("./components/SearchModal.js", () => ({ SearchModal: () => null }));
vi.mock("./components/Toast.js", () => ({ Toast: () => null }));
vi.mock("./components/CanvasSurface.js", () => ({ CanvasSurface: () => null }));
import { App } from "./App.js";

it("exposes the five workbench actions in order", () => {
  const html = renderToStaticMarkup(<App />);
  const header = html.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)?.[1] ?? "";
  const buttons = [...header.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)];
  const labels = buttons.map(match => match[1].match(/<span>(.*?)<\/span>/)?.[1]);
  expect(labels).toEqual(["自选", "搜索", "充值", "设置", "分析"]);
});
