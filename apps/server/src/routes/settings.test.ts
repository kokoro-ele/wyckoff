import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { RuntimeSettingsResponse } from "@wyckoff/shared";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDataDir = mkdtempSync(path.join(tmpdir(), "wyckoff-settings-route-"));
const environmentKeys = ["DATA_DIR", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_WEB_SEARCH"] as const;
const previousEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));

process.env.DATA_DIR = testDataDir;
process.env.OPENAI_API_KEY = "test-only-environment-key";
process.env.OPENAI_BASE_URL = "https://environment.example/v1";
process.env.OPENAI_MODEL = "environment-model";
process.env.OPENAI_WEB_SEARCH = "0";

let app: Hono;
let configModule: typeof import("../config.js");
let clientModule: typeof import("../llm/client.js");

beforeAll(async () => {
  const [{ settingsRoutes }, loadedConfig, loadedClient] = await Promise.all([
    import("./settings.js"),
    import("../config.js"),
    import("../llm/client.js"),
  ]);
  configModule = loadedConfig;
  clientModule = loadedClient;
  app = new Hono().route("/api/settings", settingsRoutes);
});

afterAll(() => {
  for (const key of environmentKeys) {
    const previous = previousEnvironment[key];
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  rmSync(testDataDir, { recursive: true, force: true });
});

describe("runtime settings API", () => {
  it("returns only the safe environment-backed settings view", async () => {
    const response = await app.request("/api/settings");
    expect(response.status).toBe(200);
    const body = (await response.json()) as RuntimeSettingsResponse;
    expect(body).toEqual({
      llm: {
        configured: true,
        source: "environment",
        baseUrl: "https://environment.example/v1",
        model: "environment-model",
        webSearch: false,
      },
    });
    expect(Object.keys(body.llm).sort()).toEqual(["baseUrl", "configured", "model", "source", "webSearch"]);
    expect(JSON.stringify(body)).not.toContain("test-only-environment-key");
  });

  it("rejects invalid or ambiguous updates without changing runtime state", async () => {
    const before = configModule.getRuntimeSettings();
    const invalidBodies = [
      { apiKey: "test-only-rejected-key", baseUrl: "file:///private/settings" },
      { apiKey: "test-only-rejected-key", removeLocalKey: true },
      { model: "" },
      { webSearch: "yes" },
      { unexpected: true },
    ];

    for (const invalidBody of invalidBodies) {
      const response = await app.request("/api/settings/llm", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(invalidBody),
      });
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain("test-only-rejected-key");
      expect(configModule.getRuntimeSettings()).toEqual(before);
    }

    const malformed = await app.request("/api/settings/llm", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(existsSync(path.join(testDataDir, "runtime-settings.json"))).toBe(false);
  });

  it("persists, hot-applies, preserves and explicitly removes a local key", async () => {
    const environmentClient = clientModule.getOpenAiClient();
    expect(clientModule.getOpenAiClient()).toBe(environmentClient);

    const localKey = "test-only-local-key";
    const saveResponse = await app.request("/api/settings/llm", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiKey: localKey,
        baseUrl: "https://local.example/v1/",
        model: "local-model",
        webSearch: true,
      }),
    });
    expect(saveResponse.status).toBe(200);
    const savedBody = await saveResponse.json();
    expect(savedBody).toEqual({
      llm: {
        configured: true,
        source: "local",
        baseUrl: "https://local.example/v1",
        model: "local-model",
        webSearch: true,
      },
    });
    expect(JSON.stringify(savedBody)).not.toContain(localKey);
    expect(configModule.isLlmConfigured).toBe(true);
    expect(configModule.config.llm.apiKey).toBe(localKey);

    const localClient = clientModule.getOpenAiClient();
    expect(localClient).not.toBe(environmentClient);
    expect(clientModule.getOpenAiClient()).toBe(localClient);

    const settingsPath = path.join(testDataDir, "runtime-settings.json");
    expect(statSync(settingsPath).mode & 0o777).toBe(0o600);

    const preserveResponse = await app.request("/api/settings/llm", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: "   ", model: "local-model-2" }),
    });
    expect(preserveResponse.status).toBe(200);
    expect(configModule.config.llm.apiKey).toBe(localKey);
    expect(configModule.config.llm.model).toBe("local-model-2");
    expect(clientModule.getOpenAiClient()).toBe(localClient);

    const baseUrlResponse = await app.request("/api/settings/llm", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: "http://127.0.0.1:11434/v1" }),
    });
    expect(baseUrlResponse.status).toBe(200);
    const newEndpointClient = clientModule.getOpenAiClient();
    expect(newEndpointClient).not.toBe(localClient);

    const removeResponse = await app.request("/api/settings/llm", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ removeLocalKey: true }),
    });
    expect(removeResponse.status).toBe(200);
    const removedBody = (await removeResponse.json()) as RuntimeSettingsResponse;
    expect(removedBody.llm).toEqual({
      configured: true,
      source: "environment",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "local-model-2",
      webSearch: true,
    });
    expect(configModule.config.llm.apiKey).toBe("test-only-environment-key");
    expect(clientModule.getOpenAiClient()).not.toBe(newEndpointClient);

    const persisted = JSON.parse(readFileSync(settingsPath, "utf8")) as { llm?: Record<string, unknown> };
    expect(persisted.llm).not.toHaveProperty("apiKey");
  });
});
