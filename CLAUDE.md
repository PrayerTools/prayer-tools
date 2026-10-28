# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

prayer.tools v3 ("with orgs"): every prayer site is a Nuxtinator org. Bun monorepo, Nuxt 4 + Nuxt UI 4, Postgres via Kysely. `plans/` is the spec (start at `plans/README.md`); `README.md` lists where the build differs from the plans or stops short. `docs/dev-context.md` holds the full RLS rules and local environment notes.

This project is a re-implementation of https://github.com/DiscipleTools/disciple-tools-prayer-campaigns that was built on Disciple.Tools. 

## Commands

```bash
bun run setup                         # install, fetch Nuxtinator layers into apps/admin/_layers, install again
bun run scripts/db-setup.ts <db>      # roles pt2_admin (BYPASSRLS) / pt2_app (RLS) + a database
bun run dev:admin                     # admin SPA (NUXT_PORT; runs migrations on boot)
bun run dev:public -- --port <port>   # public SSR server
bun run dev:worker                    # worker (bun --watch)
bun run all                           # all three in parallel (public on 3031)
DATABASE_URL=… bun run scripts/seed-dev.ts   # sample library + sites ramadan-demo, demo-247, draft-site
DATABASE_URL=… bun run scripts/migrate.ts    # migrations without booting the admin app

bun run test        # shared, worker (test DB), public, marketing (test DB)
bun run typecheck   # packages/shared only; apps: bun run --cwd apps/admin typecheck / --cwd apps/public typecheck
bun run --cwd apps/admin lint
bun run smoke       # e2e against running dev servers; needs ADMIN_URL, DATABASE_URL, PUBLIC_URL, ADMIN_DATABASE_URL
```

Single tests:
- shared: `cd packages/shared && npx vitest run test/schedule.test.ts -t "<name>"`
- worker: `cd apps/worker && npx vitest run test/jobs.test.ts -t "<name>"` (runs files serially against one shared test DB)
- marketing: `cd apps/admin/apps/marketing && npx vitest run test/deliver.test.ts`
- public: `cd apps/public && bun test tests/ics.test.ts` (bun's runner, not vitest)

Worker and marketing tests use the database named by `PT_TEST_DB` in the repo-root `.env`; their global setup migrates it with `scripts/migrate.ts`. Run one scheduled worker job once: `cd apps/worker && bun src/index.ts --run <name>`.

Ports come from each app's `.env`: `NUXT_PORT` for admin, `--port` for public, and `PT_SITE_BASE_HOST` / `PT_ADMIN_URL` must point at them in all three apps. Sites are `http://<slug>.localhost:<public>`, plus `api.localhost`, `go.localhost`, and `localhost:<public>/my`. Mail goes to Mailpit (SMTP :1025, UI :8025). `PT_SECRET` must match across admin, public and worker.

## Architecture

Three processes on one Postgres, one Docker image each (`apps/<app>/Dockerfile`, built from the repo root):

- **`packages/shared`** (`@prayertools/shared`, imported as `@prayertools/shared/<file>`, e.g. `@prayertools/shared/db/scope`): all domain logic: DB types (`src/db/schema.ts`), connections and RLS scopes, campaign setup, commitment schedules and DST-exact coverage, subscriptions/signup, CRM and inbox adapters, email transport and templates with email i18n, signed links, stats. Shared functions take the shared `Tx` type; the admin app casts its transaction with `ptTx()` (`apps/admin/apps/prayertools/server/utils/pt-context.ts`).
- **`apps/admin`**: Nuxtinator host (SPA). `layers.ts` lists the fetched Nuxtinator layers (core, tenancy, email-mailgun, ai, crm, inbox), set to track Nuxtinator `master` (recorded in `layers.lock.json`) and fetched into `_layers/`. **Never edit `_layers/`.** `NUXTINATOR_SOURCE_DIR` loads every layer from a local Nuxtinator checkout instead; `NUXTINATOR_<ID>_PATH` overrides one layer. Develop with `NUXTINATOR_SOURCE_DIR` set when changing Nuxtinator alongside the app. prayer.tools' own layers are globbed from `apps/admin/apps/*`:
  - `prayertools`: sites, campaigns, content, libraries, landing page, stats, domains, team, operator (`/admin/pt/*`) screens. `server/plugins/register-pt.ts` registers permissions, roles, apps, rail items and admin sections with Nuxtinator's registries.
  - `marketing`: site email, templates, multi-site sends, one-click unsubscribe. Written to move into Nuxtinator later.
  - The admin app **owns every migration** (`apps/admin/apps/*/migrations/`). Tenancy-retrofit migrations are named `*_T<NNN>_*` and run after all regular ones.
- **`apps/public`**: Nuxt SSR with i18n (en, es, fr, pt, ar; `i18n/locales/`). `server/middleware/01.host.ts` classifies the host (`api.` → app API under `/v1` only, OpenAPI at `/v1/openapi.json`; `go.` → short links; platform host → `/my`; any other host must resolve to a site or 404). `02.view.ts` builds a view model (`shared/view.ts`) server-side; the single catch-all page `app/pages/[...slug].vue` renders it, and client navigation fetches the same model from `/api/view`. Uses only the RLS role (`APP_DATABASE_URL`).
- **`apps/worker`**: plain TS run by bun. Global reminder sweep (`FOR UPDATE SKIP LOCKED` on `next_reminder_utc`), Postgres job queue (`src/jobs/`), marketing delivery, and croner-scheduled sweeps (`src/daily/`). Nothing loops over every site; set-based queries find due work on the BYPASSRLS connection, then per-site writes run inside that site's org on the RLS role.
- The mobile app is a separate codebase.

### Tenancy and RLS (summary; full rules in `docs/dev-context.md`)

- Two DB URLs everywhere: `DATABASE_URL` (BYPASSRLS: migrations, sweeps, operator views) and `APP_DATABASE_URL` (RLS: requests).
- Site tables carry `org_id` with policy `tenant_isolation`. Use `withOrg(db, orgId, tx => …)`; inserts omit `org_id`. Person scope: `withPerson(db, userId, …)` for a person's own subscriptions/commitments across sites.
- **One site per transaction, always.** Cross-site work visits each site in turn (`listUserOrgs` / `withOrgScope` from `#tenant/server`, `forEachOrg` in the worker).
- User-owned tables (`pt_personal_*`, `marketing_template`, `marketing_parent`) use `user_isolation` via `withUserContext(event, { appId: PT_LIBRARY_APP }, …)`.
- A new table with `org_id` but no RLS must be added to the allow-list in `apps/worker/test/isolation.test.ts`, or that test fails.
- GUCs are `SET LOCAL` and `prepare: false`, so PgBouncer transaction mode works.
- jsonb writes go through `jsonb(value)` from `@prayertools/shared/db/json` (bare `JSON.stringify` stores a jsonb string). Arrays use `pgArray(values, type)`.
- DATE columns come back as `YYYY-MM-DD` strings from shared's `createDb`, and as `Date`s from Nuxtinator's `db` in the admin app. Normalize with `toIsoDate`.

## Conventions

- Settings follow code-owned defaults: the DB stores only explicit overrides; defaults and labels live in code / i18n.
- Manage and unsubscribe links are signed tokens (rotated via `manage_version`); verification, check-in and account codes (`pt_auth_code`: sign-in links, hand-offs to other hosts, email changes) are random and stored hashed.
- Every person is a `users` row (`@prayertools/shared/accounts`). The account owns name and email; site contacts link to it via `crm_records.user_id` and get those fields copied. Public-server sign-ins are rows in core's `sessions`.
- The admin UI is English only; the public site is translated.
- Nuxtinator improvements needed by prayer.tools are made in this repo (e.g. the marketing layer), not upstream.
- Don't read other worktrees (`.worktrees/`) or branches.

## UI rules

Before any UI work — in the host or in your own app layer — read `apps/admin/_layers/core/DESIGN.md` and follow it. It lists the core components to use (help icons, sidebars, settings rows, confirm dialogs) and the styling rules every nuxtinator page shares. It updates with core, so re-read it after a core update.
