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
