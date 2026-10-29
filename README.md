# prayer.tools v3 — with orgs

Implementation of the plans in [plans/](plans/): each site is a Nuxtinator org; the admin app is Nuxtinator (core, tenancy, email-mailgun, ai, crm, inbox) plus a prayer.tools layer and a marketing layer; the public server and the worker are separate processes on the same Postgres. The mobile app is not part of this repo.

## Layout

| Path | What |
|---|---|
| `packages/shared` | Domain logic used by every process: DB types and the two RLS scopes (site, person), campaign setup and templates, commitment schedules and 24/7 coverage (DST-exact), subscriptions and signup, CRM and inbox adapters, email transport (Mailgun / SMTP) and branded templates with email i18n, signed links, stats, Statinator relay, Cloudflare for SaaS, Turnstile, the marketing host adapter. |
| `apps/admin` | `app.prayer.tools` — Nuxtinator host (SPA). Fetched layers in `_layers/` (see `layers.ts`, `layers.lock.json`); our layers in `apps/admin/apps/`: `prayertools` (sites, campaigns, content, libraries, landing page, intercessors, stats, domains, team, operator screens) and `marketing` (site email, templates, multi-site sends, one-click unsubscribe; written to move into Nuxtinator later). Owns every migration. |
| `apps/public` | Site domains, `api.` (app API, OpenAPI at `/v1/openapi.json`), `go.`, and `/my` — Nuxt SSR with i18n (en, es, fr, pt, ar; others fall back to English UI). |
| `apps/worker` | Reminder sweep, job queue (thank-yous, check-ins, domain alerts, push announcements), marketing delivery, hourly/daily sweeps (closing campaigns, personal-start completion, check-ins, unverified cleanup, app inactivity, stats refresh, domain health, retention, partitions). |
| `scripts/` | `db-setup.ts` (roles + database), `migrate.ts` (migrations without booting the admin app), `seed-dev.ts` (sample library and sites), `admin-shots.ts` (screenshots + console errors). |
| `docs/dev-context.md` | Conventions and local environment for anyone working here. |

## Local setup

```bash
bun run setup                                  # install, fetch Nuxtinator layers, install again
bun run scripts/db-setup.ts prayer_tools_v3_with_orgs_3        # roles pt2_admin (BYPASSRLS) / pt2_app (RLS) + the dev database
bun run scripts/db-setup.ts prayer_tools_v3_with_orgs_3_test   # the test database, named by PT_TEST_DB
cp .env.example .env                           # PT_TEST_DB (and NUXTINATOR_SOURCE_DIR when used)
cp apps/admin/.env.example apps/admin/.env     # fill secrets; same for apps/public and apps/worker
bun run dev:admin                              # http://localhost:2480 (NUXT_PORT) — runs migrations on boot
DATABASE_URL=postgres://pt2_admin:dev@localhost:5432/prayer_tools_v3_with_orgs_3 bun run scripts/seed-dev.ts
bun run dev:public -- --port 3480              # http://<slug>.localhost:3480, http://localhost:3480/my, http://api.localhost:3480
bun run dev:worker
```

To work against a local Nuxtinator checkout instead of the tagged releases, set `NUXTINATOR_SOURCE_DIR=/path/to/nuxtinator` in `apps/admin/.env` and the repo-root `.env`: every layer in `layers.ts` then loads from that repo (`<dir>/<subdir>`), edits there show up live, and `sync-layers` fetches nothing.

Mail goes to Mailpit (localhost:1025, UI :8025) in development. `PT_SECRET` must be the same for the admin app, public server and worker.

## Tests

```bash
bun run test     # shared unit tests, worker (test DB), public unit tests, marketing (test DB)
# admin API and public server end-to-end checks against running dev servers:
ADMIN_URL=http://localhost:2480 DATABASE_URL=… PUBLIC_URL=http://localhost:3480 ADMIN_DATABASE_URL=… bun run smoke
```

## Deployment

One image per process: `apps/<app>/Dockerfile`, built with the repo root as context. The public and worker images install only their own workspace's dependencies; the public image ships just the Nitro `.output` on Node. Two DB URLs everywhere (`DATABASE_URL` BYPASSRLS, `APP_DATABASE_URL` RLS); the public server only needs the RLS one. PgBouncer in transaction mode is supported (`prepare: false`, GUCs are `SET LOCAL`). Behind a proxy, set `PT_TRUST_PROXY=true` on the public server so it reads the visitor's host and address from the forwarded headers; without it those headers are ignored.

## Where this differs from the plans, or stops short

- **Nuxtinator upgrades are done here, not upstream.** The marketing layer lives in `apps/admin/apps/marketing`; the CRM "system actor" is a no-login system user; the consent log's wording/surface/source go in the CRM event `meta`; global suppression is `pt_suppression`; the shared transport replaces the three email paths only for prayer.tools mail (core invites/password resets still use `email-mailgun`).
- **Manage and unsubscribe links are signed tokens** (rotatable per subscription through `manage_version`, manage links expire after 400 days) rather than stored random tokens; verification, check-in and account codes (sign-in links, hand-offs, email changes) are random and stored hashed.
- **Admin UI is English only**; the public site ships five languages.
- **Site owners don't see the CRM's schema builder or permissions matrix.** `register-pt.ts` withholds `crm.schema.manage` from the `admin` role (core's `withholdFromAdmin`), so no one on a site holds it unless it is granted to them individually; operators included.
- **Accounts stop short in a few places.** Google / Apple sign-in exists on the signup form but not on `prayer.tools/my`; app installs can't yet add an email to their account.
- **Not built:** sending from a champion's own domain (DKIM), the one-step 4-day → 12-day join (only `joined_from` is recorded), an operator cross-site inbox view, the cross-site "all my people" list (deferred: it would need cross-org reads), CI axe/RTL screenshot jobs and size budgets, the WordPress importer (legacy URL handling is in place).
- **Layers track Nuxtinator `master`.** Every layer in `layers.ts` is set to `master`, so each build fetches the current master of every layer rather than a tag. The admin app relies on layer changes that are on master but not tagged (rail items, `configureApp` with `defaultStatus`, slug inbox addresses, `listUserOrgs`/`withOrgScope`, the switcher labels, `withholdFromAdmin`). A push to Nuxtinator master does not redeploy the app; it ships with the next build.
