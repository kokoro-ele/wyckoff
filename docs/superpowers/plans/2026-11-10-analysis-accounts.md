# Analysis Accounts Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify the notebook workbench and require verified accounts with permanent analysis credits and referrals.
**Architecture:** Reuse Better Auth and PostgreSQL; persist credit grants, reservations and referral bindings transactionally. Preserve existing workspace isolation and payment verification, adding a separate credit-pack order path without rewriting legacy paid orders.
**Tech Stack:** React, Hono, Better Auth emailOTP, pg, nodemailer, Vitest.
**Spec:** docs/superpowers/specs/2026-11-10-analysis-accounts-design.md

## Global Constraints
- Five header actions only; keep Looseleaf styling and chart tools.
- Signup gift 3; verified new referral gift 3; credits never expire.
- No user model keys; no anonymous analysis fallback; no removed feature routes or cron.
- Prices are operator configuration, not invented; external credentials remain environment-only.
- Preserve existing user edits and historical database records; no deployment or real payment required.

## Review Focus
- Duplicate verification/callback/referral requests must not multiply gifts (task 2).
- Concurrent analysis requests cannot overspend; failed persisted results must release reservations (task 2).
- Unverified and missing-config environments cannot bypass access (task 3).
- Checkout amount and credited units come from server snapshots, not client values (task 2).
- Settings/auth screens handle missing providers and narrow layouts (tasks 1 and 3).

### Task 1: Simplify workspace
- [ ] Remove backtest/recommendation UI and routes/scheduler; replace model settings with appearance/account settings.
- [ ] Keep exactly five top actions and only favorite in chart title actions.
- [ ] Run web typecheck and existing chart/store tests; update obsolete removed-feature tests.
Files: App.tsx, ChartPanel.tsx, ChatPanel.tsx, WatchlistSidebar.tsx, store.ts, SettingsPanel.tsx, app.ts, index.ts, vercel.json.

### Task 2: Permanent credits and credit-pack payments
- [ ] Write tests for pack validation and transactional gifts/referrals/reservations/payment idempotency; run failing tests.
- [ ] Add migrateCredits(pool), accountStatus(pool,userId), initializeAccount, reserveAnalysis, finishAnalysis, settleCreditPayment in credits/ modules.
- [ ] Add authenticated /api/account and /api/credits routes; server-priced packs from ANALYSIS_CREDIT_PACKS JSON.
- [ ] Add separate credit orders and reuse verified payment adapters; preserve legacy billing fulfillments.
- [ ] Move quota completion after durable workspace persistence; tests must prove failed work releases a reservation and duplicate successful request cannot spend twice.
- [ ] Run credit tests with an isolated Postgres test database if available; otherwise clearly report integration test limitation.

### Task 3: Verified authentication and referrals
- [ ] Write tests for auth gating, invalid referral contexts, provider configuration and verification enforcement.
- [ ] Configure Better Auth Google + emailOTP and SMTP, require verified sessions, persist signed referral intent at account creation and award on verified access.
- [ ] Replace AuthGate with login/signup/verify/reset flow; configure emailOTP client.
- [ ] Always mount AuthGate and authenticated backend; reject missing configuration rather than silently using anonymous local mode.
- [ ] Document environment keys, callback URL, migration and test commands; no secrets in docs.

### Task 4: Integrated verification
- [ ] Run typecheck, lint, tests and build; inspect browser signed-out flow and layout.
- [ ] Review implementation independently, address findings, report external Google/SMTP/payment checks still requiring operator configuration.
