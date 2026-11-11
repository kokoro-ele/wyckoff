import { afterEach, describe, expect, it, vi } from "vitest";

const { poolConstructor } = vi.hoisted(() => ({ poolConstructor: vi.fn() }));
vi.mock("pg", () => ({
  Pool: function (options: unknown) {
    poolConstructor(options);
    return { on: vi.fn() };
  },
}));

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); poolConstructor.mockClear(); });

describe("database TLS configuration", () => {
  it("uses the configured CA with verification enabled despite URL SSL options", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://app:password@db.example/test?sslmode=require&sslrootcert=old.pem");
    vi.stubEnv("DATABASE_SSL_CA", "test-ca");
    const { getPool } = await import("./postgres.js");
    getPool();
    expect(poolConstructor).toHaveBeenCalledWith(expect.objectContaining({
      connectionString: "postgres://app:password@db.example/test",
      ssl: { ca: "test-ca", rejectUnauthorized: true },
    }));
  });

  it("preserves existing URL configuration without a custom CA", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/test?sslmode=verify-full");
    vi.stubEnv("DATABASE_SSL_CA", "");
    const { getPool } = await import("./postgres.js");
    getPool();
    expect(poolConstructor).toHaveBeenCalledWith(expect.objectContaining({ connectionString: "postgres://localhost/test?sslmode=verify-full" }));
  });
});
