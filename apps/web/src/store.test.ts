import { beforeEach, expect, it, vi } from "vitest";
import type { StoredAnnotation } from "@wyckoff/shared";
vi.mock("./lib/api.js", () => ({
  fetchAnnotations: vi.fn(), fetchSessions: vi.fn(), fetchSessionMessages: vi.fn(),
  fetchInstrument: vi.fn(), clearAnnotations: vi.fn(), saveAnnotations: vi.fn(),
}));
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
const { useWorkbench: store } = await import("./store.js");
const api = await import("./lib/api.js");
const marker: StoredAnnotation = { id: "old", groupId: "g", source: "agent", kind: "level", price: 100, label: "AAPL" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  store.setState({ ...store.getInitialState(), symbol: "AAPL.US" });
  vi.mocked(api.fetchAnnotations).mockResolvedValue({ groups: [], annotations: [] });
  vi.mocked(api.fetchSessions).mockResolvedValue({ sessions: [] });
});
it("does not apply an old stock's annotation response after switching", async () => {
  const old = deferred<Awaited<ReturnType<typeof api.fetchAnnotations>>>();
  vi.mocked(api.fetchAnnotations).mockReturnValueOnce(old.promise);
  const loading = store.getState().loadAnnotations();
  await store.getState().setSymbol("MSFT.US", "Microsoft");
  old.resolve({ groups: [], annotations: [marker] });
  await loading;
  expect(store.getState().annotations).toEqual([]);
});
it("does not erase the new stock's annotations when the previous request fails", async () => {
  const old = deferred<Awaited<ReturnType<typeof api.fetchAnnotations>>>();
  vi.mocked(api.fetchAnnotations).mockReturnValueOnce(old.promise);
  const loading = store.getState().loadAnnotations();
  await store.getState().setSymbol("MSFT.US", "Microsoft");
  store.setState({ annotations: [{ ...marker, id: "new" }] });
  old.reject(new Error("late network failure"));
  await loading;
  expect(store.getState().annotations.map(a => a.id)).toEqual(["new"]);
});
it("ignores the first A response after A → B → A", async () => {
  const old = deferred<Awaited<ReturnType<typeof api.fetchAnnotations>>>();
  vi.mocked(api.fetchAnnotations).mockReturnValueOnce(old.promise);
  const loading = store.getState().loadAnnotations();
  await store.getState().setSymbol("MSFT.US", "Microsoft");
  await store.getState().setSymbol("AAPL.US", "Apple");
  old.resolve({ groups: [], annotations: [marker] });
  await loading;
  expect(store.getState().annotations).toEqual([]);
});
it("does not restore history from the previously selected stock", async () => {
  const old = deferred<Awaited<ReturnType<typeof api.fetchSessionMessages>>>();
  vi.mocked(api.fetchSessions).mockResolvedValueOnce({ sessions: [{ id: "old-session", symbol: "AAPL.US", period: "1d", title: "Old", createdAt: 1, updatedAt: 1 }] });
  vi.mocked(api.fetchSessionMessages).mockReturnValueOnce(old.promise);
  const loading = store.getState().restoreSessionForSymbol("AAPL.US");
  await Promise.resolve();
  await store.getState().setSymbol("MSFT.US", "Microsoft");
  old.resolve({ messages: [{ id: "m", role: "assistant", content: "Old stock", createdAt: 1 }] });
  await loading;
  expect(store.getState().messages).toEqual([]);
  expect(store.getState().sessionId).not.toBe("old-session");
});
it("clears pending drawing, selection and focus when switching stock", async () => {
  store.setState({ activeTool: "segment", selectionMode: true, focusRequest: { startTime: 1, endTime: 2, nonce: 1 } });
  await store.getState().setSymbol("MSFT.US", "Microsoft");
  expect(store.getState().activeTool).toBeNull();
  expect(store.getState().selectionMode).toBe(false);
  expect(store.getState().focusRequest).toBeNull();
});
it.each(["period", "adjust"])("finishes interrupted messages when changing %s without touching completed messages", (kind) => {
  store.setState({ messages: [
    { id: "done", role: "assistant", content: "Finished", createdAt: 1 },
    { id: "live", role: "assistant", content: "Partial", createdAt: 2, streaming: true,
      liveTrace: [{ id: "t", name: "draw", summary: "执行中…", ok: true, running: true }] },
  ] });
  if (kind === "period") store.getState().setPeriod("1w");
  else store.getState().setAdjust("none");
  expect(store.getState().messages[1].streaming).toBe(false);
  expect(store.getState().messages[1].liveTrace?.[0].running).toBe(false);
  expect(store.getState().messages[0].content).toBe("Finished");
});
it("keeps a valid stock name response even if the period changed", async () => {
  const name = deferred<Awaited<ReturnType<typeof api.fetchInstrument>>>();
  vi.mocked(api.fetchInstrument).mockReturnValue(name.promise);
  const switching = store.getState().setSymbol("MSFT.US");
  await Promise.resolve(); await Promise.resolve();
  store.getState().setPeriod("1w");
  name.resolve({ instrument: { symbol: "MSFT.US", name: "Microsoft" } } as Awaited<ReturnType<typeof api.fetchInstrument>>);
  await switching;
  expect(store.getState().instrumentName).toBe("Microsoft");
});
