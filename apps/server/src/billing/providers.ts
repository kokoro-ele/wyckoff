import { createHmac, timingSafeEqual, randomBytes, sign, verify, createDecipheriv } from "node:crypto";
import { BillingError } from "./catalog.js";
import type { Provider } from "./catalog.js";

type Env = NodeJS.ProcessEnv;

export function availability(env: Env = process.env) {
  const origin = env.BILLING_PUBLIC_ORIGIN;
  const base = !!origin && /^https:\/\/[^/]+$/.test(origin);
  const wechatKeys = [
    "WECHAT_MCH_ID",
    "WECHAT_APP_ID",
    "WECHAT_MERCHANT_SERIAL",
    "WECHAT_PRIVATE_KEY",
    "WECHAT_PLATFORM_KEY_ID",
    "WECHAT_PLATFORM_PUBLIC_KEY",
    "WECHAT_API_V3_KEY",
  ];
  return {
    stripe: {
      available: base && !!env.STRIPE_SECRET_KEY && !!env.STRIPE_WEBHOOK_SECRET,
    },
    wechat: {
      available:
        base &&
        wechatKeys.every((key) => !!env[key]) &&
        Buffer.byteLength(env.WECHAT_API_V3_KEY ?? "") === 32,
    },
    alipay: {
      available: false,
      reason: "Alipay is not activated; merchant onboarding and adapter are not yet available",
    },
  };
}

export function verifyStripe(
  body: string,
  header: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): Record<string, any> {
  const parts = header.split(",").map((part) => part.split("="));
  const timestamps = parts.filter(([key]) => key === "t");
  const timestamp = timestamps[0]?.[1];
  if (
    timestamps.length !== 1 ||
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > 300
  ) {
    throw new BillingError("INVALID_SIGNATURE", "Invalid signature", 401);
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  const valid = parts
    .filter(([key]) => key === "v1")
    .some(
      ([, signature]) =>
        !!signature &&
        /^[a-f0-9]{64}$/i.test(signature) &&
        timingSafeEqual(expected, Buffer.from(signature, "hex")),
    );
  if (!valid) throw new BillingError("INVALID_SIGNATURE", "Invalid signature", 401);
  return JSON.parse(body);
}

interface WechatVerifier {
  platformKey: string;
  platformKeyId: string;
  apiV3Key: string;
}

function verifyWechatSignature(body: string, headers: Headers, config: WechatVerifier, now: number) {
  const timestamp = headers.get("Wechatpay-Timestamp") ?? "";
  const nonce = headers.get("Wechatpay-Nonce");
  const signature = headers.get("Wechatpay-Signature");
  let valid = false;
  if (
    /^\d+$/.test(timestamp) &&
    Math.abs(now - Number(timestamp)) <= 300 &&
    nonce &&
    signature &&
    headers.get("Wechatpay-Serial") === config.platformKeyId
  ) {
    try {
      valid = verify(
        "RSA-SHA256",
        Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),
        config.platformKey,
        Buffer.from(signature, "base64"),
      );
    } catch {
      valid = false;
    }
  }
  if (!valid) throw new BillingError("INVALID_SIGNATURE", "Invalid signature", 401);
}

export function verifyWechat(
  body: string,
  headers: Headers,
  config: WechatVerifier,
  now = Math.floor(Date.now() / 1000),
) {
  verifyWechatSignature(body, headers, config, now);
  const event = JSON.parse(body);
  const resource = event.resource;
  if (resource?.algorithm !== "AEAD_AES_256_GCM") {
    throw new BillingError("INVALID_EVENT", "Unsupported resource");
  }
  const encrypted = Buffer.from(resource.ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(config.apiV3Key), resource.nonce);
  decipher.setAuthTag(encrypted.subarray(-16));
  decipher.setAAD(Buffer.from(resource.associated_data ?? ""));
  const transaction = JSON.parse(
    Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString("utf8"),
  );
  return { event, transaction };
}

export interface CheckoutOrder {
  id: string;
  provider: Provider;
  plan: string;
  period: string;
  amount: number;
  currency: string;
  expires_at: Date;
}

export async function createProviderCheckout(order: CheckoutOrder, env: Env = process.env) {
  if (!availability(env)[order.provider].available) {
    throw new BillingError("PROVIDER_UNAVAILABLE", "Payment merchant is not activated", 503);
  }
  const origin = env.BILLING_PUBLIC_ORIGIN!;

  if (order.provider === "stripe") {
    const body = new URLSearchParams({
      mode: "payment",
      success_url: `${origin}/?billing=success&order=${order.id}`,
      cancel_url: `${origin}/?billing=cancel`,
      client_reference_id: order.id,
      "metadata[order_id]": order.id,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": order.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(order.amount),
      "line_items[0][price_data][product_data][name]": `Wyckoff ${order.plan} ${order.period} prepaid`,
      "payment_method_types[0]": "card",
      expires_at: String(Math.floor(order.expires_at.getTime() / 1000)),
    });
    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": order.id,
        "Stripe-Version": "2025-02-24.acacia",
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new BillingError("PROVIDER_UNAVAILABLE", "Payment provider could not create checkout", 503);
    }
    const data = (await response.json()) as { id: string; url: string };
    if (!data.id || !data.url || new URL(data.url).hostname !== "checkout.stripe.com") {
      throw new BillingError("INVALID_PROVIDER_RESPONSE", "Invalid checkout response", 503);
    }
    return { providerId: data.id, checkoutUrl: data.url };
  }

  const path = "/v3/pay/transactions/native";
  const body = JSON.stringify({
    appid: env.WECHAT_APP_ID,
    mchid: env.WECHAT_MCH_ID,
    description: `Wyckoff ${order.plan} ${order.period}`,
    out_trade_no: order.id,
    time_expire: order.expires_at.toISOString(),
    notify_url: `${origin}/api/billing/webhooks/wechat`,
    amount: { total: order.amount, currency: "CNY" },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString("hex");
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`POST\n${path}\n${timestamp}\n${nonce}\n${body}\n`),
    env.WECHAT_PRIVATE_KEY!.replace(/\\n/g, "\n"),
  ).toString("base64");
  const response = await fetch(`https://api.mch.weixin.qq.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${env.WECHAT_MCH_ID}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${env.WECHAT_MERCHANT_SERIAL}",signature="${signature}"`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await response.text();
  verifyWechatSignature(
    raw,
    response.headers,
    {
      platformKey: env.WECHAT_PLATFORM_PUBLIC_KEY!.replace(/\\n/g, "\n"),
      platformKeyId: env.WECHAT_PLATFORM_KEY_ID!,
      apiV3Key: env.WECHAT_API_V3_KEY!,
    },
    Math.floor(Date.now() / 1000),
  );
  if (!response.ok) {
    throw new BillingError("PROVIDER_UNAVAILABLE", "Payment provider could not create checkout", 503);
  }
  const data = JSON.parse(raw);
  if (typeof data.code_url !== "string" || !data.code_url.startsWith("weixin://wxpay/")) {
    throw new BillingError("INVALID_PROVIDER_RESPONSE", "Invalid payment response", 503);
  }
  return { providerId: order.id, codeUrl: data.code_url as string };
}
