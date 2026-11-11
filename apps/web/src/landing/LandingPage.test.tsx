import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
import { I18nProvider } from "../i18n.js";
import { LandingPage } from "./LandingPage.js";

it("renders the hand-drawn product site with a workbench entry", () => {
  const html = renderToStaticMarkup(
    <I18nProvider>
      <LandingPage />
    </I18nProvider>,
  );
  expect(html).toContain("看见价格背后的结构");
  expect(html).toContain("Wyckoff 是价格和成交量讲的故事");
  expect(html).toContain('href="/app"');
  expect(html).toContain("AAPL.US");
});
