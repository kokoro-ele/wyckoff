import { expect, it, vi } from "vitest";
import type { Chart, OverlayCreate } from "klinecharts";
import type { StoredAnnotation } from "@wyckoff/shared";
vi.mock("klinecharts", () => ({ registerOverlay: () => {} }));
import { annotationToOverlay, renderAnnotations } from "./annotations.js";
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

it("localizes common zone and level labels for English chart annotations", () => {
  const zone: StoredAnnotation = {
    id: "zone", groupId: "g", kind: "zone", source: "agent", label: "吸筹交易区间", phase: "B",
    startTime: 1, endTime: 2, low: 90, high: 100,
  };
  const level: StoredAnnotation = { id: "level", groupId: "g", kind: "level", source: "agent", label: "水平线", price: 100 };
  expect(annotationToOverlay(zone, "en").extendData).toMatchObject({ label: "Accumulation range" });
  expect(annotationToOverlay(level, "en").extendData).toMatchObject({ label: "Level" });
  expect(annotationToOverlay(zone, "zh").extendData).toMatchObject({ label: "吸筹交易区间" });
});
