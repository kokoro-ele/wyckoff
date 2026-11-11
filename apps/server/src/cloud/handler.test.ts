import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { session, work } = vi.hoisted(() => ({ session: vi.fn(), work: vi.fn() }));
vi.mock("./auth.js", () => ({ getAuth: () => ({ api: { getSession: session } }) }));
vi.mock("./workspace.js", () => ({
  withWorkspace: work,
  WorkspaceTooLargeError: class WorkspaceTooLargeError extends Error {},
}));
import { cloudFetch } from "./handler.js";

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("allows health checks without accessing user storage", async () => {
  const response = await cloudFetch(new Request("https://example.com/api/health"));
  expect(response.status).toBe(200);
  expect(work).not.toHaveBeenCalled();
});

describe("authentication and origin boundaries", () => {
  it("rejects unauthenticated API reads and writes before opening storage", async () => {
    session.mockResolvedValue(null);
    for (const method of ["GET", "POST", "DELETE"]) {
      const response = await cloudFetch(new Request("https://example.com/api/sessions", { method }));
      expect(response.status).toBe(401);
    }
    expect(work).not.toHaveBeenCalled();
  });

  it("rejects unverified accounts before opening storage", async () => {
    session.mockResolvedValue({ user: { id: "unverified", emailVerified: false } });
    const response = await cloudFetch(new Request("https://example.com/api/credits/status"));
    expect(response.status).toBe(401);
    expect(work).not.toHaveBeenCalled();
  });

  it("rejects cross-origin writes with a valid session", async () => {
    session.mockResolvedValue({ user: { id: "alice", emailVerified: true } });
    const response = await cloudFetch(
      new Request("https://example.com/api/settings/llm", {
        method: "PUT",
        headers: { Origin: "https://attacker.example" },
      }),
    );
    expect(response.status).toBe(403);
    expect(work).not.toHaveBeenCalled();
  });

  it("accepts same-origin writes behind a local Vite proxy", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:5273");
    session.mockResolvedValue({ user: { id: "alice", emailVerified: true } });
    work.mockResolvedValue({ value: Response.json({ ok: true }), deferred: [] });

    // The Node server sees the proxy's rewritten Host, while the browser's
    // Origin remains the canonical frontend origin.
    const response = await cloudFetch(
      new Request("http://127.0.0.1:8787/api/sessions", {
        method: "POST",
        headers: { Origin: "http://localhost:5273" },
      }),
    );
    expect(response.status).toBe(200);
    expect(work).toHaveBeenCalledOnce();
    quiet.mockRestore();
  });

  it("does not expose removed scheduled jobs to anonymous requests", async () => {
    session.mockResolvedValue(null);
    const response = await cloudFetch(new Request("https://example.com/api/cron/recommend"));
    expect(response.status).toBe(401);
    expect(work).not.toHaveBeenCalled();
  });
});
