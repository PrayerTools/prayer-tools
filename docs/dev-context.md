# Development context (for everyone working in this repo)

Monorepo for prayer.tools v3 (with orgs). Plans live in `plans/` — they are the spec.

## Layout

| Path | What |
|---|---|
| `packages/shared` | `@prayertools/shared`: DB types (`src/db/schema.ts`), connections and RLS scopes (`src/db/connect.ts`, `src/db/scope.ts`, `src/db/json.ts`), domain logic (setup, schedule, coverage, content, subscriptions, stats, links, crm/inbox adapters, email transport and templates, i18n for email, statinator, cloudflare, turnstile, rate limit). Import as `@prayertools/shared/<file>` e.g. `@prayertools/shared/db/scope`. |
| `apps/admin` | Nuxtinator host (SPA) on port **2480** (`NUXT_PORT`). Layers fetched into `_layers/` (never edit), or loaded from a local Nuxtinator checkout when `NUXTINATOR_SOURCE_DIR` is set. prayer.tools' own layers in `apps/admin/apps/*`. Owns ALL migrations (`apps/admin/apps/prayertools/migrations/pt_T001_schema.ts`). |
| `apps/public` | Public server (Nuxt SSR) on port **3480** (`--port 3480`): site domains, `api.` host, `go.` host, `/my`. |
| `apps/worker` | Background worker (plain TypeScript run by bun). |
| `scripts/db-setup.ts` | Creates roles `pt2_admin` (BYPASSRLS) / `pt2_app` (RLS) and a database. |
| `scripts/seed-dev.ts` | Seeds a platform library and three sites (`ramadan-demo` published, `demo-247` published coverage, `draft-site` draft). |

## Local environment

- Postgres on localhost:5432. Dev DB `prayer_tools_v3_with_orgs_3`; test DB named by `PT_TEST_DB` in the repo-root `.env` (`prayer_tools_v3_with_orgs_3_test`, see `.env.example`).
  - Admin role URL: `postgres://pt2_admin:dev@localhost:5432/<db>` (BYPASSRLS; migrations, worker sweeps)
  - App role URL: `postgres://pt2_app:dev@localhost:5432/<db>` (RLS enforced; admin requests, public server)
- Migrations run when the admin app boots; `scripts/migrate.ts` runs the same set standalone (the test suites use it), loading layer migrations from `NUXTINATOR_SOURCE_DIR` when set.
- Mailpit: SMTP localhost:1025, UI http://localhost:8025 (`MAIL_PROVIDER=smtp`).
- Sites in dev: `http://<slug>.localhost:3480`; platform host (My prayer) `http://localhost:3480/my`; API `http://api.localhost:3480`; go host `http://go.localhost:3480`. (`PT_SITE_BASE_HOST=localhost:3480`.)

## RLS and scopes

- Site tables carry `org_id` with policy `tenant_isolation` on `app.current_org`. Use `withOrg(db, orgId, tx => …)` from `@prayertools/shared/db/scope`. Inserts omit `org_id` (defaults to `current_org_id()`).
- Person scope: `withPerson(db, userId, …)` sets `app.current_intercessor` to the person's user id; `pt_subscription`, `pt_commitment`, `pt_person_total` have a SELECT policy for the person's own rows (`user_id`) across sites. Writes always happen inside the site's org, one site at a time.
- One site per transaction, always. Work that covers several sites (Your sites, multi-site sends) visits each site in turn with `withOrgScope(orgId, …)` / `listUserOrgs(userId, { permission, appId })` from `#tenant/server` (or `forEachOrg` in the worker). No policy admits another org's rows; `apps/worker/test/isolation.test.ts` checks it.
- User-owned tables (`pt_personal_asset`, `pt_personal_block`, `marketing_template`, `marketing_parent`): policy `user_isolation` on `app.current_user`. Their handlers run in the `library` personal app: `withUserContext(event, { appId: PT_LIBRARY_APP }, …)` from `#core/server/utils/personal-apps`.
- Global tables (no RLS): `orgs`, `memberships`, `users`, `sessions`, `pt_user_device`, `pt_auth_code`, `pt_suppression`, `pt_library*`. Always filter them explicitly.
- Tables with an `org_id` but no RLS, because they are read before the site is known or across sites by design; each is always filtered by `org_id` (or its own key) in code. `apps/worker/test/isolation.test.ts` holds this exact list, so a new `org_id` table without RLS fails the test:
  - `pt_site_domain` — the public server resolves a request's host to its site before any org is set.
  - `pt_legacy_key` — old links resolve to their site before any org is set.
  - `pt_directory_entry` — the public directory, reviewed by operators.
  - `pt_site_report` — reports from the public about a site, reviewed by operators.
  - `pt_job` — the worker's queue; jobs carry their site and run inside it.
  - `marketing_parent_recipient` — a multi-site send's one-email-per-person ledger: an address fingerprint (SHA-256) and the site the person was assigned to. Only the worker writes and reads it, inside each site's org in turn; its upsert has to replace a row assigned to another of the send's sites, which an org-only policy would refuse. No API serves it.
- The worker's BYPASSRLS connection only finds due work and does housekeeping; recipients are worked out inside each site's org on the RLS role.
- jsonb writes: use `jsonb(value)` from `@prayertools/shared/db/json` (a bare `JSON.stringify` stores a jsonb *string*). Arrays: `pgArray(values, 'text' | 'smallint' | …)`.
- DATE columns come back as `YYYY-MM-DD` strings from `createDb` (shared); from Nuxtinator's `db` in the admin app they come back as Dates — normalize with `toIsoDate`.

## Conventions (the user's standing rules)

- Comments: very sparing; one or two lines max stating what the code does and why. Describe the code as it is, never the change that produced it.
- Settings follow code-owned defaults: the DB stores only explicit overrides; defaults and labels live in code / i18n. Never persist a default value or a display label.
- Nuxt UI `USelect`/`USelectMenu`: never put an item with `value: ''` in `:items` (Reka throws); use `placeholder` for the empty state.
- Don't commit. Don't read other worktrees or branches.
- Stop any server you start before finishing.
