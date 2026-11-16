import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
import { I18nProvider } from "../i18n.js";
import { LandingPage } from "./LandingPage.js";

it("renders a compact intro, the NVDA chart and the method link", () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <LandingPage />
    </I18nProvider>,
  );
  expect(html).toContain("See the structure behind the price.");
  expect(html).toContain("Start now");
  expect(html).toContain("Learn Wyckoff");
  expect(html).toContain("NVDA.US");
  expect(html).toContain('href="/app?start=1"');
  expect(html).toContain('href="/learn/en"');
  expect(html).toContain("https://www.wyckoffanalytics.com/wyckoff-method/");
  expect(html).not.toContain("AAPL.US");
  expect(html).not.toContain("打开工作台");
  expect(html).not.toContain("一张书桌");
});
