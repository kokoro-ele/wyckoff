import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
import { I18nProvider } from "../i18n.js";
import { LandingPage } from "./LandingPage.js";

it("renders a compact intro, the NVDA chart and the glossary", () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <LandingPage />
    </I18nProvider>,
  );
  expect(html).toContain("看见价格背后的结构");
  expect(html).toContain("现在开始");
  expect(html).toContain("学习 Wyckoff");
  expect(html).toContain("NVDA.US");
  expect(html).toContain("Spring");
  expect(html).toContain("SOS");
  expect(html).toContain("LPS");
  expect(html).toContain("UT");
  expect(html).toContain('href="/app?start=1"');
  expect(html).toContain('href="/learn/zh"');
  expect(html).not.toContain("AAPL.US");
  expect(html).not.toContain("打开工作台");
  expect(html).not.toContain("一张书桌");
});
