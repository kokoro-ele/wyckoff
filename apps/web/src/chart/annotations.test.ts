import { expect, it, vi } from "vitest";
import type { Chart, OverlayCreate } from "klinecharts";
import type { StoredAnnotation } from "@wyckoff/shared";
vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));
import { renderAnnotations } from "./annotations.js";
it("removes old rendered overlays when replaced or cleared, retaining unrelated drawings", () => {
  const overlays = new Set<string>(["manual"]);
  const chart = {
    removeOverlay: ({ id }: { id: string }) => { overlays.delete(id); },
    createOverlay: (items: OverlayCreate[]) => { items.forEach(item => overlays.add(item.id!)); },
  } as unknown as Chart;
  const old: StoredAnnotation = { id: "aapl", groupId: "g", kind: "level", source: "agent", label: "AAPL", price: 100 };
  renderAnnotations(chart, [old]);
  renderAnnotations(chart, [{ ...old, id: "msft" }]);
  expect([...overlays].sort()).toEqual(["manual", "msft"]);
  renderAnnotations(chart, []);
  expect([...overlays]).toEqual(["manual"]);
});
