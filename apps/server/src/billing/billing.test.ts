import { describe, it, expect } from "vitest";
import { createHmac, generateKeyPairSync, sign, createCipheriv } from "node:crypto";
import { addPeriod } from "./catalog.js";
import { verifyStripe, verifyWechat } from "./providers.js";

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
  it("authenticates and decrypts WeChat resource, rejects wrong key id and tampering", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const key = "12345678901234567890123456789012";
    const nonce = "123456789012";
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(key), nonce);
    cipher.setAAD(Buffer.from("transaction"));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify({ trade_state: "SUCCESS" })),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64");
    const body = JSON.stringify({
      id: "evt",
      event_type: "TRANSACTION.SUCCESS",
      resource: { algorithm: "AEAD_AES_256_GCM", nonce, associated_data: "transaction", ciphertext },
    });
    const headers = new Headers({
      "Wechatpay-Timestamp": "1800000000",
      "Wechatpay-Nonce": "nonce",
      "Wechatpay-Serial": "PUB_KEY_ID_1",
      "Wechatpay-Signature": sign("RSA-SHA256", Buffer.from(`1800000000\nnonce\n${body}\n`), privateKey).toString(
        "base64",
      ),
    });
    const config = {
      platformKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      platformKeyId: "PUB_KEY_ID_1",
      apiV3Key: key,
    };
    expect(verifyWechat(body, headers, config, 1800000000).transaction.trade_state).toBe("SUCCESS");
    expect(() => verifyWechat(body + " ", headers, config, 1800000000)).toThrow();
    expect(() => verifyWechat(body, headers, { ...config, platformKeyId: "other" }, 1800000000)).toThrow();
  });
});
