# Vercel deployment

The Vite frontend and Hono API deploy together from the repository root. `/api/*`
requests reach `api/index.mjs`; the backend workspace code is bundled with esbuild,
and the API never starts a persistent HTTP listener.

## Resources and configuration

1. Link a Vercel project and connect a PostgreSQL database (Neon or Supabase).
2. Configure the required values:

   - `DATABASE_URL`
   - `BETTER_AUTH_SECRET` (at least 32 random characters)
   - `BETTER_AUTH_URL` (required canonical origin, for example `https://workbench.example.com`)
   - `WORKSPACE_ENCRYPTION_KEY` (32 random bytes, hex encoded)

   Keep the encryption key stable. Changing or losing it makes existing workspaces
   unreadable. Back it up through your secrets manager.

3. Optional but commonly required:

   - `DATABASE_SSL_CA` for a provider CA such as Supabase.
   - `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_WEB_SEARCH` for the operator default. Users can optionally store their own encrypted model settings from Settings → My model.
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` for email OTP; add `SMTP_USER`/`SMTP_PASS` only for authenticated relays. `SMTP_REQUIRE_TLS` overrides the default STARTTLS policy (587 requires it, 465 uses implicit TLS, local catchers usually use 1025 without TLS).
   - `SEC_USER_AGENT` with an operator contact address for SEC EDGAR fundamentals. The research endpoint uses Tencent quote data for valuation and SEC annual facts for US fundamentals; it does not consume model credits.
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` for Google OAuth.
   - `ANALYSIS_CREDIT_PACKS`, `BILLING_PUBLIC_ORIGIN`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` for Stripe Checkout top-ups.
   - `PG_POOL_MAX` (default 10) and `DEBUG_LLM=1` only for temporary diagnostics.

4. Pull the project environment with `vercel env pull .env.local --yes`.
5. Run `pnpm -F @wyckoff/server db:migrate` **before deployment**. This creates
   Better Auth tables, `workspaces`, billing tables, and the permanent credit ledger.
6. Run `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm build`.
7. Stage with `vercel deploy --prod --skip-domain`, verify registration, logout,
   login, private API access, account isolation, and a credit consumption/refund,
   then promote the deployment.

`BETTER_AUTH_URL` is not optional: it is the trusted origin for Better Auth and for
the API's CSRF origin check. Preview deployments need their own environment if they
must support login.

## Local development

Local development uses the same authenticated cloud handler:

```bash
cp .env.example .env
# Fill DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL=http://localhost:5273,
# WORKSPACE_ENCRYPTION_KEY, and OPENAI_API_KEY in .env.
pnpm -F @wyckoff/server db:migrate
pnpm dev
```

The dev server and migration script read both `.env` and `.env.local` (the latter
wins), so you can keep local values in `.env` and Vercel-pulled values in
`.env.local`. There is no anonymous SQLite-only mode in the default entry point.

## Persistence and concurrency

Better Auth uses native Postgres tables. Each user's SQLite analysis workspace is
serialized, compressed, AES-256-GCM encrypted with the user ID as associated data,
and stored in one `workspaces` row. Workspaces contain watchlists, chat sessions,
annotations, market caches, and legacy analysis records. New accounts start empty;
the existing local `data/` is never uploaded or assigned to a new account.

Requests use AsyncLocalStorage and execution-time statement resolution to keep
accounts isolated, including streaming chat and cached prepared statements. Writes
lock a user's Postgres row for the request or background job, serializing mutations
across Vercel instances. Read-only requests use the last committed snapshot and skip
serialization when no scoped write occurred. Stale read-modify-write snapshots are
retried under the row lock instead of silently discarding cache updates.

Credit reservations, finalization, and refunds run in the same Postgres transaction
as the workspace write. The snapshot is persisted before the credit state is
finalized, and a rollback refunds the reservation.

This is a small-workbench storage design, not a high-volume analytics database:
workspaces have a 64 MiB uncompressed cap, snapshots require whole-workspace I/O, and
simultaneous writes for one account serialize. When a workspace approaches the cap,
re-fetchable kline and instrument caches are dropped automatically; user chats,
annotations, and watchlists are never removed. For larger workloads, migrate
individual tables to Postgres and use a durable job queue.

## Serverless chat

Streaming chat uses Vercel `waitUntil` to keep the workspace transaction alive while
the model streams. If the browser disconnects, the server keeps draining the agent
stream so a completed answer can still be persisted and charged; a client-side stop
does not create a free successful analysis. Functions have a 300-second maximum and
a 240-second model deadline.

The API exports a web-standard `fetch` handler from `api/index.mjs`. `.vercelignore`
excludes local data, environment files, tests, docs, and personal artifacts from the
source upload. The build command bundles `apps/server/src/cloud/handler.ts` into
`apps/server/dist/cloud.mjs`, which the function imports.

## Verification

For a disposable integration database:

```bash
TEST_DATABASE_URL=postgres://… pnpm -F @wyckoff/server test
```

CI runs the same command with a PostgreSQL service. Payment activation and merchant
configuration are documented separately in [payment setup](./payment-setup.md).
