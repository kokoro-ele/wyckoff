import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { addPeriod } from "./catalog.js";
import { verifyStripe } from "./providers.js";

describe("prepaid billing", () => {
  it("clamps calendar month/year entitlement dates", () => {
    expect(addPeriod(new Date("2026-01-31T12:00:00Z"), "monthly").toISOString()).toBe("2026-02-28T12:00:00.000Z");
    expect(addPeriod(new Date("2024-02-29T12:00:00Z"), "annual").toISOString()).toBe("2025-02-28T12:00:00.000Z");
  });
  it("authenticates raw Stripe payload, rejects tampering and stale timestamps", () => {
    const body = '{"id":"evt_1"}';
    const now = 1800000000;
    const secret = "whsec_test";
    const digest = createHmac("sha256", secret).update(`${now}.${body}`).digest("hex");
    expect(verifyStripe(body, `t=${now},v1=${digest}`, secret, now)).toEqual({ id: "evt_1" });
    expect(() => verifyStripe(body + " ", `t=${now},v1=${digest}`, secret, now)).toThrow();
    expect(() => verifyStripe(body, `t=${now},v1=${digest}`, secret, now + 301)).toThrow();
  });
});
