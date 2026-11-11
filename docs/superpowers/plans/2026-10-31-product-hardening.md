# Workbench reliability, themes and membership implementation

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver reliable chart switching and recommendation execution, polished light/dark themes, and server-authoritative membership/payment infrastructure.

**Architecture:** Keep React/Zustand/Hono, Better Auth, and the deployed Supabase database. Keep private workspace snapshots for this release. Billing uses native Postgres transactional records separate from workspace snapshots. Provider credentials remain server-side; no configured merchant means no purchasable checkout.

**Tech Stack:** React, Tailwind, Klinecharts, Hono, pg, Vitest.

**Spec:** User request of 2026-10-31 plus docs/superpowers/specs/2026-10-29-cloud-membership-design.md. User delegates product/payment choices; current request explicitly retains recommendations.

## Global constraints

- Existing dirty workspace contains already-deployed cloud work; preserve all unrelated changes and exclude personal output/tmp files from deployments.
- Free, Pro CNY 49/month or 490/year, Research CNY 149/month or 1490/year. USD 9/90 and 25/250. Annotation quantities unlimited.
- Domestic prepaid month/year, overseas card. Do not pretend merchant accounts exist. Payment receipt only from validated provider event, never browser redirect.
- Chart must never show new symbol/title with old candles or prices. Theme changes must update chart, dialogs and controls.
- Persist tests and deployment evidence; no claims of live paid checkout without real provider credentials.

## Tasks

- [ ] Chart and theme: mask stale data immediately, consistent loading/error/retry, persisted system/light/dark theme, Longbridge-inspired orange/neutral palette, visible search affordance.
- [ ] Recommendations: investigate state/index/model failures, ensure preflight and truthful errors, recover stale running state, regression tests.
- [ ] Billing: plans, native schema, authenticated status/checkout routes, signed webhook fulfillment, price validation/idempotency, quota enforcement and membership UI.
- [ ] Verify typecheck/tests/lint/build; migrate billing tables; deploy isolated complete reviewed source; verify live endpoints.

## Review focus

Rapid A/B/A switching, failed/empty chart fetch, unsupported LLM web search, missing merchant credentials, forged/duplicate/out-of-order payment callbacks, quota races and failed-task refunds.
