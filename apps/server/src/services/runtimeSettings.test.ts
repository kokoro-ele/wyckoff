import { mkdtempSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRuntimeSettings, saveRuntimeSettings } from "./runtimeSettings.js";

const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("runtime settings storage", () => {
  it("round-trips a strict settings file with owner-only permissions", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "wyckoff-runtime-settings-"));
    tempDirectories.push(directory);
    const filePath = path.join(directory, "runtime-settings.json");

    // 模拟一个权限过宽的旧文件；保存时必须收紧。
    writeFileSync(filePath, '{"version":1}\n', { mode: 0o644 });
    saveRuntimeSettings(filePath, {
      version: 1,
      llm: {
        apiKey: "test-only-local-key",
        baseUrl: "https://gateway.example/v1",
        model: "test-model",
        webSearch: false,
      },
    });

    expect(loadRuntimeSettings(filePath)).toEqual({
      version: 1,
      llm: {
        apiKey: "test-only-local-key",
        baseUrl: "https://gateway.example/v1",
        model: "test-model",
        webSearch: false,
      },
    });
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it("returns an empty versioned document when the file does not exist", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "wyckoff-runtime-settings-"));
    tempDirectories.push(directory);
    expect(loadRuntimeSettings(path.join(directory, "missing.json"))).toEqual({ version: 1 });
  });

  it("rejects unknown persisted fields", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "wyckoff-runtime-settings-"));
    tempDirectories.push(directory);
    const filePath = path.join(directory, "runtime-settings.json");
    writeFileSync(filePath, '{"version":1,"unexpected":true}\n', { mode: 0o600 });
    expect(() => loadRuntimeSettings(filePath)).toThrow();
  });
});
