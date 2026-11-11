# Wyckoff Agent Workbench

**English** · [简体中文](./README.md)

An AI workspace for single-asset price-and-volume research: professional candlestick charts, Wyckoff structure analysis, semantic annotations, per-account encrypted research workspaces, and permanent analysis credits with referrals.

> This project is for research and education. It is not investment advice, a performance guarantee, or an automated trading service.

![Automated AAPL Wyckoff analysis with trading ranges, event markers, support and resistance, and trendlines](./docs/screenshots/workbench.jpg)

Open **Analysis**, then choose **Auto analysis**. The Agent draws trading ranges, Wyckoff events, support and resistance, and trendlines directly on the chart while keeping the explanation and tool trace on the right.

## Highlights

- **Professional chart workspace** with zooming, panning, crosshair, timeframes, adjustments, indicators, and drawing tools.
- **Wyckoff Agent** for Phase A–E and events such as SC, AR, ST, Spring, SOS, LPS, UTAD, and SOW, rendered directly on the chart.
- **Verified accounts** via email OTP or Google; watchlists, sessions, annotations, and market caches are isolated per account.
- **Permanent analysis credits**: one credit per user-initiated analysis or follow-up. Server/model failures refund automatically; history, charts, and manual annotations are free.
- **Referrals**: a new verified user receives 3 credits; each verified invite awards the inviter another 3.
- **Credit-pack top-ups** configured by the operator through `ANALYSIS_CREDIT_PACKS`, with Stripe and WeChat Native payments.
- **Operator-only model credentials**: users cannot override the platform model URL or API key.
- **Encrypted workspaces**: each account's SQLite workspace is compressed and encrypted with AES-256-GCM before being stored in PostgreSQL.

The recommendation, scanner, AI-backtest, and user-supplied model-key surfaces are no longer mounted. Historical database rows are preserved for compatibility and are not migrated to new accounts.

## Quick start

### Requirements

- Node.js 22.x or later
- pnpm 9
- PostgreSQL (local development authenticates too)

### Install and run

```bash
pnpm install
cp .env.example .env
```

At minimum, configure:

```env
DATABASE_URL=postgres://...
BETTER_AUTH_SECRET=<at least 32 random characters>
BETTER_AUTH_URL=http://localhost:5273
WORKSPACE_ENCRYPTION_KEY=<32 random bytes as hex>
OPENAI_API_KEY=<operator model key>
SMTP_HOST=
SMTP_PORT=587
SMTP_FROM=
# Only for authenticated relays; leave empty for a local catcher.
SMTP_USER=
SMTP_PASS=
```

Then initialize the database and start the app:

```bash
pnpm -F @wyckoff/server db:migrate
pnpm dev
```

- Web app: <http://localhost:5273>
- API server: <http://127.0.0.1:8787>
- Wyckoff method reference: <http://localhost:5273/wyckoff.html>

> The dev server and `db:migrate` both read `.env` and `.env.local`; the latter wins. You can also provide configuration only through the process environment. The first search syncs the instrument directory into the current account's workspace.

Email registration requires SMTP; Google OAuth can be used on its own. If the database, auth secret, canonical URL, or workspace encryption key is missing, the UI reports that login is not configured instead of falling back to anonymous mode.

## Credits and top-ups

- A verified new account receives 3 permanent credits once; they do not reset monthly.
- Each user-initiated analysis or follow-up consumes 1 credit. Model/server failures refund it.
- A successful request with the same `Idempotency-Key` never charges twice; a failed, refunded request may retry with the same key.
- Credit-pack price and units come from the server-side order snapshot; clients cannot submit amounts.
- Payment confirmation is based on verified Stripe/WeChat callbacks. Replays never add credits twice.
- Purchases stay unavailable until a merchant is configured; free credits and referrals still work.

See [payment setup](docs/payment-setup.md) for the full merchant checklist.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `TICKFLOW_BASE_URL` / `TICKFLOW_API_KEY` | Market-data endpoint and optional paid key |
| `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` | Operator-only model configuration |
| `OPENAI_WEB_SEARCH` | Enables Responses `web_search` |
| `DEBUG_LLM` | Set to `1` only to log full prompts/history; off by default |
| `DATABASE_URL` / `DATABASE_SSL_CA` | PostgreSQL connection and optional CA |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | Auth secret and canonical site origin |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | OTP email and password reset |
| `WORKSPACE_ENCRYPTION_KEY` | 32-byte hex; changing it makes old workspaces unreadable |
| `ANALYSIS_CREDIT_PACKS` | JSON array; empty disables purchases |
| `BILLING_PUBLIC_ORIGIN` | HTTPS origin for checkout returns and provider callbacks |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe one-time Checkout |
| `WECHAT_*` | WeChat Pay API v3 Native configuration |
| `PG_POOL_MAX` | PostgreSQL pool size, default 10 |
| `PORT` / `DATA_DIR` | Local port and SQLite directory |

See [`.env.example`](./.env.example) for the complete template.

## Commands

```bash
pnpm dev          # run web and API services
pnpm -F @wyckoff/server db:migrate  # auth, workspace, billing, and credit tables
pnpm typecheck    # TypeScript checks for the whole workspace
pnpm test         # all tests
pnpm lint         # ESLint
pnpm build        # production build
```

PostgreSQL integration tests need a disposable database:

```bash
TEST_DATABASE_URL=postgres://... pnpm -F @wyckoff/server test
```

## Repository layout

```text
apps/web                 React + Vite product UI
apps/server              Hono API, auth, credits, payments, encrypted workspaces
packages/shared          Shared types, Zod protocols, and API contracts
packages/wyckoff         Features, structures, and deterministic backtest engine (library)
docs/                    Deployment, account, payment, and screenshot docs
data/                    Local SQLite cache (Git ignored)
```

## Implementation principles

- The Agent returns domain semantics rather than pixel coordinates; the frontend maps them onto chart overlays.
- Credits are reserved, consumed, or refunded in the same transaction that persists the workspace snapshot.
- Workspace writes use PostgreSQL row locks and a version CAS; read-only requests do not reserialize unchanged data.
- Near the 64 MiB cap, re-fetchable market caches are evicted automatically; user annotations, sessions, and favorites are never discarded.
- Payment amounts, credits, currency, and orders are server-snapshotted; callbacks must pass signature and amount checks.
- Users cannot override the model URL, model ID, or API key; operator credentials come only from the environment.

## Deployment

See [Vercel deployment](docs/vercel-deployment.md) for deployment, migrations, environment variables, and concurrency limits, and [account setup](docs/account-setup.md) for login and referral behavior.
