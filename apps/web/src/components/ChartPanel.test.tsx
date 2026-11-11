import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.hoisted(() => { vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} }); });
vi.mock("klinecharts", () => ({ init: vi.fn(), dispose: vi.fn(), registerOverlay: vi.fn() }));
vi.mock("../auth/AuthProvider.js", () => ({
  useAuth: () => ({
    session: null,
    isPending: false,
    isVerified: false,
    requireAuth: vi.fn(),
    openAuth: vi.fn(),
    closeAuth: vi.fn(),
  }),
}));
import { ChartPanel } from "./ChartPanel.js";
import { ChartToolbar } from "./ChartToolbar.js";
import { I18nProvider } from "../i18n.js";

describe("chart loading interaction", () => {
  it("masks the candle surface while the first request is pending", () => {
    const html = renderToStaticMarkup(<I18nProvider><ChartPanel /></I18nProvider>);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('visibility:hidden');
    expect(html).toContain("正在加载");
    expect(html).not.toContain('class="market-quote');
    expect(html).not.toContain('aria-label="界面主题"');
    expect(html).not.toContain("AI 计划回测");
    expect(html).toContain("收藏");
  });
  it("disables drawing and range selection while allowing context switching", () => {
    const html = renderToStaticMarkup(<I18nProvider><ChartToolbar dataReady={false} /></I18nProvider>);
    expect(html).toMatch(/title="框选区间提问" disabled=""/);
    expect(html).not.toMatch(/title="日线" disabled=""/);
  });
});
