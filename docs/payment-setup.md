# Payment activation and credit operations

The product sells **permanent analysis credit packs**, not monthly plans. Payments are one-time WeChat Pay API v3 **Native** QR payments in CNY or Stripe hosted Checkout payments in USD. There is no automatic debit or renewal.

Legacy Pro/Research subscription orders are no longer sold, but already-paid subscriptions remain in `billing_subscriptions` and are consumed before permanent credits. The webhook still fulfills those historical orders.

Accounts/merchant approval and real payment acceptance have not been completed. Do not advertise working payments until the activation checklist below passes.

## Pricing and entitlements

- Prices and credit counts come **only** from the server-side `ANALYSIS_CREDIT_PACKS` JSON array. There are no built-in paid prices.
- Amounts are minor units (cents/fen). WeChat packs must use `CNY`; Stripe packs use their configured currency.
- A pack looks like:

```json
[
  { "id": "ten", "name": "10 次", "credits": 10, "amount": 1000, "currency": "CNY" }
]
```

- New verified accounts receive 3 permanent credits; verified referrals award 3 to the inviter.
- Each analysis or follow-up consumes 1 credit. Viewing history, charts, and manual annotations is free.
- Credits **never expire**. Legacy monthly/annual quota rows expire at the UTC calendar-month boundary, as before.
- Failed operations release reservations; successful operations consume them.
- A retried successful request key never executes or charges twice. A refunded failed request may retry with the same key.

There is no BYOK path and no `BILLING_ENFORCEMENT_ENABLED` bypass: the server always enforces credits, and users cannot supply model keys or prices.

## Database and environment

Run `pnpm -F @wyckoff/server db:migrate` against the deployment database using its owner/migration role. It creates:

- Better Auth tables and `workspaces`
- `billing_orders`, `billing_subscriptions`, `billing_events`, `billing_usage` (legacy orders remain compatible)
- `credit_accounts`, `credit_ledger`, `credit_usage`, `credit_meta`, `auth_referral_intents`

The server connection must have owner or explicit privileged server access; public, `anon`, and `authenticated` roles cannot access these RLS-protected tables. Never place provider secrets in `VITE_*` variables or browser settings.

All provider availability checks require `BILLING_PUBLIC_ORIGIN=https://your-domain.example` (HTTPS origin, no trailing slash/path), plus the provider keys below.

## Authenticated endpoints

All endpoints require a verified session and are mounted by the cloud handler:

- `GET /api/credits/catalog` — packs and provider availability
- `GET /api/credits/status` — balance, invite code, invite count
- `GET /api/credits/orders/current` — the latest pending checkout
- `GET /api/credits/orders/:id` — owner-only order polling
- `POST /api/credits/checkout` — `{ packId, provider }` with `Idempotency-Key`

Order creation is server-priced. The client cannot submit an amount or credit count. There is at most one creating/pending checkout per account; abandoned checkouts expire after 35 minutes. A provider timeout may leave a real remote order, which is retained locally so a later verified callback can still credit it.

## Stripe

Server-only variables:

- `STRIPE_SECRET_KEY`: secret/restricted API key with Checkout Session creation permissions; start with test mode.
- `STRIPE_WEBHOOK_SECRET`: signing secret for this deployment's endpoint.

Register `POST https://your-domain.example/api/billing/webhooks/stripe` as an account-level **snapshot** webhook for `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Connect-account events are rejected. Use API version `2025-02-24.acacia`, matching the adapter's pinned version.

Test and live webhook secrets differ. Event `livemode` must match the API key mode. Hosted Checkout uses card-only payments, fixed server-side prices, no coupons/automatic tax. Decide taxes and required invoicing before live activation; this implementation does not calculate tax.

## WeChat Pay

Server-only variables:

- `WECHAT_MCH_ID`: approved direct merchant number with Native Pay enabled.
- `WECHAT_APP_ID`: merchant-associated approved app ID.
- `WECHAT_MERCHANT_SERIAL`: merchant API certificate serial used to identify the request-signing key.
- `WECHAT_PRIVATE_KEY`: merchant RSA private PEM, real newlines or literal `\n` supported.
- `WECHAT_API_V3_KEY`: exactly 32 UTF-8 bytes, used for AES-256-GCM resource decryption.
- `WECHAT_PLATFORM_KEY_ID`: pinned WeChat Pay public key ID (`PUB_KEY_ID_…`) or platform certificate serial.
- `WECHAT_PLATFORM_PUBLIC_KEY`: matching WeChat Pay RSA public PEM/platform certificate PEM, real newlines or literal `\n` supported.

Register/allow `POST https://your-domain.example/api/billing/webhooks/wechat`; this exact URL is sent in Native orders. Request signatures are RSA-SHA256; both Native API responses and callbacks require a matching pinned WeChat key ID and valid signature. Callback resources are AES-GCM-authenticated and decrypted, then merchant ID, app ID, Native trade type, success status, order, amount, and currency are checked.

Public key/certificate rotation is **manual**: deploy the new matching ID/key pair in a maintenance window; no automatic certificate download is implemented. Host time synchronization matters: callback signatures allow five minutes of timestamp skew.

## Activation checklist

1. Finish merchant onboarding, business verification, payment permissions, approved domains, settlement account, customer support/refund terms, and tax/invoice policy.
2. Set `BILLING_PUBLIC_ORIGIN`, provider keys, and `ANALYSIS_CREDIT_PACKS` in the server deployment secret store; run schema migrations.
3. Verify `GET /api/credits/catalog` reports the intended packs and provider availability. Verify unauthenticated requests fail and another account cannot read an order.
4. Stripe: complete test Checkout and replay its signed webhook. Verify exactly one grant; wrong amount, mode, signature, currency, or order must not grant. Then configure live keys and the live endpoint secret.
5. WeChat: validate using an approved merchant and a controlled real payment; Native integration has no simulated success mode. Scan the generated QR, confirm the provider transaction and exactly one server grant. Retry the notification and confirm no extra credits.
6. Check pending recovery after refresh, 35-minute expiry, successful retry with the same key, failed provider requests, and success/failure credit handling.
7. Only after acceptance, advertise purchases publicly.

## Operations and limits

- One creating/pending checkout per account. Checkout requires `Idempotency-Key`; repeated keys cannot change pack/provider. Failed creation releases the slot; a timeout can still leave a real provider order, retained locally for a later verified callback.
- Checkout creation is rate-limited to 10 attempts per 10 minutes per account. Referral-intent creation is limited to 10 requests per minute per IP.
- All paid orders are credited once through unique provider-event and payment-transaction constraints.
- A server-side failed checkout poisons its idempotency key; start a new checkout with a new key. The UI does this automatically when it receives `CHECKOUT_FAILED`.
- Refunds, chargebacks, reconciliation of missing callbacks, receipts/invoices, customer support tooling, and automatic public-key rotation are **not automated**. Operators must review provider dashboards and perform audited manual corrections/refunds.
- A process crash may leave a reservation until its 24-hour expiry. Usage and the encrypted workspace snapshot are separate rows; a failure saving an already-completed result may require an audited credit correction. This is not an exactly-once distributed job runner.
- Free-credit abuse (many verified throwaway accounts) is an operator risk. Add email-domain, IP, or invite-rate controls before high-volume public launch.

## Integration tests

PostgreSQL tests require a dedicated disposable database:

```bash
TEST_DATABASE_URL=postgres://… pnpm -F @wyckoff/server test
```

The suites truncate their fixture tables. Never point them at production. Regular test runs skip these suites when the variable is absent; CI runs them with a disposable service.

Official references: [Stripe Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create), [Stripe signed webhook handling](https://docs.stripe.com/webhooks), [WeChat official API v3 SDK, signing and callback decryption](https://github.com/wechatpay-apiv3/wechatpay-go), [WeChat Native merchant API](https://pay.weixin.qq.com/doc/v3/merchant/4012791900).

## 中文开通速查

当前产品卖的是**永久次数包**，不是月/年套餐；价格和次数只由服务端 `ANALYSIS_CREDIT_PACKS` 决定，客户端不能传金额。次数不会清零，分析/追问每次扣 1 次，失败返还，成功请求的同一 Idempotency-Key 不会重复扣次。

1. 国内申请微信支付商户并开通 Native 扫码，准备商户号、AppID、API v3 密钥、商户私钥和微信支付公钥。
2. 海外信用卡使用 Stripe；先用测试模式验证 Checkout 与 Webhook，再切换正式密钥。
3. 将 `BILLING_PUBLIC_ORIGIN`、`ANALYSIS_CREDIT_PACKS`、Stripe/微信密钥放入服务端 Secret，绝不放入前端变量。
4. 回调地址分别为 `/api/billing/webhooks/wechat` 与 `/api/billing/webhooks/stripe`。
5. 验收成功付款、重复回调、错误金额、跨账号查订单、失败任务退次数、失败后换 key 重试。
6. 退款、争议、发票、漏回调对账目前需要人工处理；开卖前确定客服与操作流程。
