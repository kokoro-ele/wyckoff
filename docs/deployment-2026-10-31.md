> Historical deployment log. Current setup and limitations are documented in README.md, docs/account-setup.md, docs/payment-setup.md, and docs/vercel-deployment.md.

# 2026-10-31 release status

## Search index correction

Search previously skipped full instrument synchronization whenever any cached instrument existed. Loading the initial AAPL chart populated one row, preventing GOOG searches from discovering the full catalog. The search route now checks `isSyncNeeded()` (successful sync timestamp and TTL), with a regression test that preloads AAPL and then searches GOOG. All 93 tests, typecheck, lint and build pass. A read-only TickFlow check returned 12,486 US instruments including GOOG.US and GOOGL.US. Browser session verification was unavailable during this correction.

## Update: database connected and production promoted

- New production deployment: `dpl_Bsap7cYXuh5we93zo44m5fFiTtuP`, READY and explicitly promoted.
- URL: https://wyckoff-hxcsn99p1-elekokoro-gmailcoms-projects.vercel.app
- Supabase project: `iowajexinchxltawqxxj` (`wyckoff`, Singapore), ACTIVE_HEALTHY; connected through Vercel resource `supabase-wyckoff`.
- Created the six Better Auth/workspace tables; RLS enabled and `anon`/`authenticated` table access revoked. Security advisors report only informational no-policy notices, expected for backend-only tables.
- `DATABASE_URL` and `DATABASE_SSL_CA` saved as Production Secrets. Database TLS verifies the official Supabase CA and hostname. Temporary pulled credential file removed.
- Added custom CA support to `cloud/postgres.ts` with two regression tests. 92 tests passed, 2 benchmarks skipped; typecheck, lint and build passed.
- Deployed `/api/auth/get-session` returns HTTP 200 with null for an unauthenticated visitor, replacing the previous 503.
- Full production sign-up/write tests were not performed: automatic approval rejected the proposed test because its remote account cleanup was incomplete. No test accounts were created.
- Existing Vercel SSO protection remains enabled. Google sign-in, payments and the broader native-Postgres redesign remain unimplemented.

The following records the earlier staging state before this update.

- Project: `wyckoff` (`prj_4OUDwKuJzrZRW4fHYvC13IZWyb2u`)
- Team: `team_k7Gp3YhN6b1rp4p8UR8je6Sw`
- Deployment: `dpl_7yUwEDHFJ8vUHFUZ14Gm16E1G96U`
- URL: https://wyckoff-bj3o6qxt0-elekokoro-gmailcoms-projects.vercel.app
- Target: production, staged with `--skip-domain`; build READY. No explicit promotion performed.
- Source: isolated 107-file upload in `/private/tmp/wyckoff-release-20261031`, based on the previous deployment's 108-file source manifest. Not a new Git commit.

## Released code changes

Stock/period changes invalidate stale chart, annotation and chat work; previous overlays are cleared. Markdown renders headings and GFM tables without the old streaming preprocessor.

SHA1 comparison against deployment `dpl_6gC35JQXP8hG9Gc8JuPhRUeuf8yg` confirmed every backend, authentication, database and deployment configuration file was identical. Differences were the five frontend fix files, removal of `streamingMarkdown.ts`, frontend test dependency/lockfile updates, and `.vercelignore` exclusions. Unrelated local artifacts, personal documents, secrets and tests were excluded from the upload.

## Verification

- 90 tests passed; 2 existing benchmark tests skipped.
- Typecheck, lint, local build and `git diff --check` passed.
- Vercel build passed on Node 22.
- `/api/health`: 200. This endpoint does not check database connectivity.
- `/api/auth/get-session`: 503 on both the new and previous deployment.
- Production environment variable listing contains the auth, encryption and cron secrets but no `DATABASE_URL`. Local `.env` and `.env.local` also lack that key; values were not printed.
- Existing Vercel SSO protection remains enabled. Anonymous access to the project alias redirects to authentication.

## Required to make the application usable

1. Supply a dedicated Postgres connection as `DATABASE_URL` in the project's Production environment, or authorize provisioning a database. Keep credentials out of chat.
2. Run the existing database migration against that intended database, then redeploy with the new environment.
3. Verify login, authenticated workspace isolation and data persistence before promoting the deployment to the intended production domain.
4. Confirm public access requirements before changing existing deployment protection.

Google login, native Postgres business-table migration, market browsing and payments remain in the proposed design; this release does not implement them.

## 2026-11-01 Canvas workspace and memberships

- Production: `dpl_75YtjwqSAsakB9aNtW4bpm36aPdr`, promoted to https://wyckoff-one.vercel.app/.
- Built from isolated reviewed source directory, 117 source files, excluding personal artifacts and credentials.
- Added collapsible Canvas workspace docks, focus mode, visible search, persisted light/dark/system theme, synchronized chart loading context.
- Recommendation jobs initialize the US directory in fresh user contexts, verify required web search, and persist actionable failures.
- Native Postgres billing tables migrated with RLS and revoked anon/authenticated grants; verified both roles cannot SELECT.
- Implemented prepaid WeChat/Stripe adapters, signature checks, owner-only orders, idempotent entitlements and usage quotas. Merchant configuration absent: purchase unavailable and enforcement off.
- Validation: full unit suite, typecheck, ESLint, build, diff whitespace checks passed; candidate /api/health returned 200. Browser final acceptance recorded below.
- Live browser acceptance: GOOG/GOOGL search returns results; AAPL→GOOG immediately shows GOOG loading without stale quote; GOOG persisted annotations render, GOOG→AAPL immediately removes GOOG annotation group. Focus mode hides both docks. Light/dark selectors work. Membership modal reads live database and shows Free/Pro/Research, ¥49/¥149, unavailable checkout, enforcement off.
- Live recommendation/provider and payment transactions were not triggered by this acceptance run; recommendation behavior verified with regression tests and payment transaction behavior verified in isolated PostgreSQL tests. Actual merchant acceptance remains pending.

## 2026-11-01 Official Canvas UI integration

User clarified Canvas UI means https://canvasui.dev/. Vendored official Grid React/WebGL component from its shadcn registry, with upstream MIT + Commons Clause license. Used in brand area, login hero and membership hero. Added persisted effect toggle and reduced-motion fallback; no experimental browser flags or origin-trial token enabled. Core chart and payment inputs remain ordinary interactive UI. Frontend typecheck, lint, 21 tests, production build and whitespace checks passed.

Release: `dpl_4MvBYLZiQ2DCARdrqAmq14iai1vG` (`wyckoff-l28eg4f3v-elekokoro-gmailcoms-projects.vercel.app`).

## Sidebar simplification

Production `dpl_EF5Un1KFPF3MwPrhWPREX7AfgMZd`: combined managed watch/enter lists into a single visual 美股推荐 group (data preserved); removed rotation/debug summaries and duplicate bottom search button; reduced footer to 扫描美股 / 推荐记录. Account controls now occupy a separate top flex row instead of a fixed bottom overlay. Typecheck, lint and production build passed.
