# Stripe payment configuration

The product sells **permanent analysis credit packs**. Payment is a one-time **Stripe hosted Checkout** card payment; there is no automatic renewal or subscription mandate. WeChat Pay has been removed from the product and codebase.

## Pricing and packs

Prices and credit counts come only from the server-side `ANALYSIS_CREDIT_PACKS` JSON array. There are no built-in paid prices.

```json
[
  { "id": "credits_10", "name": "10 credits", "credits": 10, "amount": 500, "currency": "USD" },
  { "id": "credits_50", "name": "50 credits", "credits": 50, "amount": 2000, "currency": "USD" }
]
```

- `amount` is in the currency's **minor unit** (cents for USD).
- `id` must be unique and URL-safe; `credits` is a positive integer.
- Use `USD` for standard Stripe card Checkout. If your Stripe account supports another currency, the pack currency must match what Checkout supports.
- Leave `ANALYSIS_CREDIT_PACKS` empty to keep purchases unavailable.
- New verified accounts still receive 3 permanent credits; referrals still award 3.

## Environment variables

Set these on the server (Vercel Production/Preview or `.env.local` for local development):

```env
BILLING_PUBLIC_ORIGIN=https://your-domain.example
ANALYSIS_CREDIT_PACKS=[{"id":"credits_10","name":"10 credits","credits":10,"amount":500,"currency":"USD"}]
STRIPE_SECRET_KEY=sk_test_or_live_secret
STRIPE_WEBHOOK_SECRET=whsec_test_or_live_secret
```

- `BILLING_PUBLIC_ORIGIN` must be an HTTPS origin with no path or trailing slash in production. Local development may use `http://localhost:5273`; the availability check allows this only when `NODE_ENV !== "production"`.
- `STRIPE_SECRET_KEY`: use `sk_test_…` while testing and `sk_live_…` in production. A restricted key (`rk_…`) is fine if it can create Checkout Sessions.
- `STRIPE_WEBHOOK_SECRET`: the signing secret for the endpoint below. Test and live mode have different secrets.
- No Stripe publishable key is needed: Checkout is hosted by Stripe and the server creates the session.

Never put any Stripe secret in a `VITE_*` variable or in the browser.

## Stripe Dashboard setup

1. Create/activate a Stripe account. Use **Test mode** first.
2. Developers → API keys → copy the secret key into `STRIPE_SECRET_KEY`.
3. Developers → Webhooks → **Add endpoint**:
   - URL: `https://your-domain.example/api/billing/webhooks/stripe`
   - Events: `checkout.session.completed` and `checkout.session.async_payment_succeeded`
   - API version: `2025-02-24.acacia` (the server pins this version)
4. Copy the endpoint's **Signing secret** into `STRIPE_WEBHOOK_SECRET`.
5. Run the schema migration once: `pnpm -F @wyckoff/server db:migrate`.
6. Deploy/restart, then open Account → Top up and confirm the packs appear.

The checkout session uses:
- `mode=payment` (one-time, not subscription)
- server-side `price_data` from the configured pack (the browser cannot submit an amount)
- `client_reference_id` and `metadata.order_id` set to the internal order ID
- `success_url` / `cancel_url` derived from `BILLING_PUBLIC_ORIGIN`
- card-only payment methods

## Local testing

The server can create Checkout Sessions with a local success URL, but Stripe cannot reach `localhost` for webhooks. Forward signed webhooks with the Stripe CLI:

```bash
brew install stripe/stripe-cli/stripe   # or see Stripe CLI docs
stripe login
stripe listen --forward-to localhost:5273/api/billing/webhooks/stripe
```

The CLI prints a `whsec_…` value. Put it in `.env.local`:

```env
BILLING_PUBLIC_ORIGIN=http://localhost:5273
ANALYSIS_CREDIT_PACKS=[{"id":"credits_10","name":"10 credits","credits":10,"amount":500,"currency":"USD"}]
STRIPE_SECRET_KEY=sk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…   # from stripe listen
```

Restart the dev server with `PORT=8788 pnpm dev`, then:

1. Open `http://localhost:5273`.
2. Sign in and go to Account → Top up.
3. Buy a pack.
4. Use Stripe's test card `4242 4242 4242 4242`, any future expiry date, any CVC, any postal code.
5. After redirect, the order should show `paid`, and the balance should increase exactly once.
6. Replay the event with `stripe events resend <event_id>` (or the CLI's replay) and confirm the balance does not change.

If you do not use the Stripe CLI, expose the app through an HTTPS tunnel (ngrok, Cloudflare Tunnel, etc.) and register the tunnel URL as the webhook endpoint and `BILLING_PUBLIC_ORIGIN`.

## API flow

Authenticated endpoints:

- `GET /api/credits/catalog` — packs and `providers.stripe.available`
- `GET /api/credits/status` — balance, invite code, invite count
- `GET /api/credits/orders/current` — pending order recovery
- `GET /api/credits/orders/:id` — owner-only order polling
- `POST /api/credits/checkout` — `{ packId, provider: "stripe" }` with `Idempotency-Key`

Public webhook:

- `POST /api/billing/webhooks/stripe`

## Security and idempotency

- Checkout amounts and credits come from the server snapshot, never the client.
- The webhook verifies the raw Stripe signature, timestamp skew, livemode, Checkout `mode=payment`, payment intent, metadata/order match, currency and amount.
- `billing_events` has unique provider/event and transaction constraints; a replay or duplicate delivery grants credits at most once.
- There is at most one creating/pending checkout per account. Checkout requires an `Idempotency-Key`; failed creation can be retried with a new key.
- Checkout creation is rate-limited to 10 attempts per 10 minutes per account.
- Credits are persisted in the same Postgres transaction that finishes the analysis; wallet top-ups add credits through the same ledger.

## Production checklist

1. Complete Stripe business verification, bank account, statement descriptor, support/refund policy, and tax/invoice decisions.
2. Switch to live keys and a live webhook endpoint/signing secret.
3. Set `BILLING_PUBLIC_ORIGIN` to the production HTTPS origin.
4. Run `db:migrate` and verify `GET /api/credits/catalog` reports Stripe available.
5. Complete a real low-value payment, confirm the webhook grant, replay the event, and check the Stripe dashboard.
6. Keep refunds, chargebacks, receipts/invoices, and missed-webhook reconciliation as manual operator procedures. They are not automated in this codebase.
7. Monitor webhook failures and paid orders without entitlements.

## Historical data

Existing WeChat orders and events may remain in the database for audit and manual reconciliation. They are not processed by the server anymore, because the WeChat adapter and webhook route have been removed. Do not delete historical rows blindly.

Official references: [Stripe Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create), [Stripe webhooks](https://docs.stripe.com/webhooks), [Stripe CLI](https://docs.stripe.com/stripe-cli).

## 中文速查

1. 在 Stripe 后台创建账户，先切到测试模式。
2. 把 `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET` 和 `BILLING_PUBLIC_ORIGIN` 放进服务端环境变量。
3. 在 `ANALYSIS_CREDIT_PACKS` 配置次数包；金额单位是分，例如 $5.00 写 `500`。
4. Webhook 地址：`https://你的域名/api/billing/webhooks/stripe`；订阅事件 `checkout.session.completed` 和 `checkout.session.async_payment_succeeded`。
5. 本地测试用 Stripe CLI 转发回调，测试卡 `4242 4242 4242 4242`。
6. 微信支付已从代码、UI 和环境变量中移除；历史微信订单保留在数据库里，但不再自动处理。
