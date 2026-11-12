# Pricing model proposal

## Why per-analysis pricing feels wrong

Wyckoff research is iterative: users compare symbols, ask follow-ups, change timeframes and revisit a structure. Charging for every question punishes exactly the behavior the product is meant to encourage. It also creates support overhead and makes revenue hard to predict.

## Recommended model

| Tier | Price | Included | Best for |
| --- | --- | --- | --- |
| Free | $0 | 3 lifetime platform analyses | Trying the workbench |
| Pro (monthly) | $19 / month | 200 platform analyses per month, fair-use rate limits, history and annotations | Active research users |
| Day pass | $6 / 24 hours | 20 platform analyses | Occasional event-driven users |
| Bring your own model | Pro subscription not required | Unlimited analyses using the user's own Base URL/model/key; platform credits are not consumed | Cost-sensitive or privacy-sensitive users |
| Team | later | Seats, shared watchlists, admin billing | Small research teams |

Rules:

- Platform-model usage draws from the included monthly quota. Unused Pro quota can roll over for one month, capped at 400.
- Own-model requests do not consume platform credits and do not count toward the fair-use quota.
- Own-model users are still rate-limited and must comply with the provider's terms.
- Legacy purchased credits remain valid; no forced migration.
- A free account can upgrade without losing watchlists, chats or annotations.

## Why subscription + quota

- Aligns revenue with recurring research use rather than penalizing questions.
- Protects model cost with a predictable quota.
- The own-model option removes marginal model cost and gives privacy-conscious users a clear path.
- A day pass covers users who do not want a subscription.

## Stripe implementation notes

- Use Stripe Checkout in `subscription` mode for Pro; use `payment` mode for the day pass.
- Webhooks: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
- Store the Stripe customer ID and subscription ID; never trust the client for entitlement.
- Add Customer Portal for cancellation and invoices.
- Taxes, receipts, refund policy and business entity details must be finalized before enabling live payments.

## Current state

Online payment is not enabled yet. The free allowance is 3 analyses. Admin can adjust balances from `/admin`. The product does not advertise a price until the Stripe catalog and compliance pages are reviewed.

## Review of the proposed numbers

The two credit packs are reasonable for the current product:

- Small: **$5 → 30 credits** (about $0.167 per platform analysis)
- Big: **$10 → 80 credits** (about $0.125 per platform analysis)

The monthly proposal needs adjustment:

- **$20/month + 20 credits/day** can yield up to **600 credits/month**, or about **$0.033 per analysis**. That is far below the pack price and is easy to farm with daily check-ins.
- Recommended version: **$20/month includes 150–200 credits**, plus a **daily check-in of 5 credits** capped at 100–150 per month. This keeps the subscription attractive without undercutting packs.
- If you want to keep 20/day, price the monthly plan around **$39–49** or cap the daily bonus at 10 days/month.
- Daily credits should expire (24 hours or end of billing month), while purchased pack credits remain permanent.
- One check-in per verified user per UTC day, enforced by a unique `(user_id, day)` row; do not trust the browser.

### Recommended initial catalog

| Product | Price | Grant |
| --- | --- | --- |
| Small pack | $5 one-time | 30 permanent credits |
| Big pack | $10 one-time | 80 permanent credits |
| Pro monthly | $20/month | 200 monthly credits + 5/day check-in (monthly cap 150) |
| Own model | Free with account | No platform credits consumed |
| Day pass | Optional $6 | 20 platform credits valid 24h |

## Stripe setup checklist

1. Create a Stripe account and complete business/tax details. If your entity is in mainland China, confirm eligibility or use an HK/SG/US entity; otherwise consider Paddle or Lemon Squeezy.
2. In test mode, create Products and Prices:
   - `small_pack`: one-time $5, metadata `credits=30`
   - `big_pack`: one-time $10, metadata `credits=80`
   - `pro_monthly`: recurring $20/month
3. Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to Vercel Production. Never expose them to the frontend.
4. Set `BILLING_PUBLIC_ORIGIN=https://easywyckoff.online` and configure success/cancel URLs.
5. Create a webhook endpoint:
   - `https://easywyckoff.online/api/billing/webhooks/stripe`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
6. Extend the server catalog to include the two one-time packs and the recurring plan. The current code supports one-time credit packs; recurring subscriptions and daily check-ins need new entitlement tables/endpoints.
7. Grant credits **only from a verified webhook**, using the Stripe event ID for idempotency. Never grant from the browser success redirect.
8. Test with card `4242 4242 4242 4242`, duplicate webhook delivery, failed payment, cancellation and refund.
9. Enable Customer Portal for invoices/cancellation; add terms, privacy and refund links (already at `/privacy`, `/terms`, `/refund`).
10. Before going live, have the legal/tax/refund documents reviewed and confirm the merchant entity.
