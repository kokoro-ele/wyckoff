import { expect, it, vi } from "vitest";

it("uses operator model credentials and has no user-override path", async () => {
  vi.stubEnv("OPENAI_API_KEY", "operator-test");
  vi.stubEnv("OPENAI_MODEL", "operator-model");
  vi.resetModules();
  try {
    const { config, hasLlmConfiguration } = await import("./config.js");
    expect(config.llm.apiKey).toBe("operator-test");
    expect(config.llm.model).toBe("operator-model");
    expect(hasLlmConfiguration()).toBe(true);
  } finally {
    vi.unstubAllEnvs();
  }
});
