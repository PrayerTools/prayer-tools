# prayer.tools v3 — with orgs

Implementation of the plans in [plans/](plans/): each site is a Nuxtinator org; the admin app is Nuxtinator (core, tenancy, mail, social-auth, oauth, mcp, ai, records, crm, inbox) plus a prayer.tools layer and a marketing layer; the public server and the worker are separate processes on the same Postgres. The mobile app is not part of this repo.

## Layout

| Path | What |
|---|---|
| `packages/shared` | Domain logic used by every process: DB types and the two RLS scopes (site, person), campaign setup and templates, commitment schedules and 24/7 coverage (DST-exact), subscriptions and signup, CRM and inbox adapters, email transport (Mailgun / SMTP) and branded templates with email i18n, signed links, stats, Statinator relay, Cloudflare for SaaS, Turnstile, the marketing host adapter. |
| `apps/admin` | `app.prayer.tools` — Nuxtinator host (SPA). Fetched layers in `_layers/` (see `layers.ts`, `layers.lock.json`); our layers in `apps/admin/apps/`: `prayertools` (sites, campaigns, content, libraries, landing page, intercessors, stats, domains, team, operator screens) and `marketing` (site email, templates, multi-site sends, one-click unsubscribe; written to move into Nuxtinator later). Owns every migration. |
| `apps/public` | Site domains, `api.` (app API, OpenAPI at `/v1/openapi.json`), `go.`, and `/my` — Nuxt SSR with i18n (en, es, fr, pt, ar; others fall back to English UI). |
| `apps/worker` | Reminder sweep, job queue (thank-yous, check-ins, domain alerts, push announcements), marketing delivery, hourly/daily sweeps (closing campaigns, personal-start completion, check-ins, unverified cleanup, app inactivity, stats refresh, domain health, retention, partitions). |
| `scripts/` | `db-setup.ts` (roles + database), `migrate.ts` (migrations without booting the admin app), `seed-dev.ts` (sample library and sites), `seed-use-cases.ts` (a site per use case in `USE_CASES.md`), `admin-shots.ts` (screenshots + console errors). |
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

## MCP for AI clients

The admin app is an MCP server at `<NUXT_PUBLIC_SITE_URL>/mcp`, so champions can add prayer.tools to claude.ai or ChatGPT as a custom connector and sign in through OAuth (set `OAUTH_CONSENT_COOKIE_SECRET` and `OAUTH_ALLOW_DCR=true`). The prayer.tools tools (`apps/admin/apps/prayertools/mcp/`) create sites and campaigns, edit the landing page and signup form, and stack, write and translate prayer content; the site email tools (`apps/admin/apps/marketing/mcp/`) save drafts only. Content goes in and out as a flat block list (`@prayertools/shared/content-blocks`), not Tiptap JSON. Publishing, sending, ending a campaign, deleting and domains stay in the admin. Tools never return intercessors' personal data, except the inbox layer's tools; the CRM layer's MCP tools are turned off (`mcpDisabledApps`).

## CLI for platform libraries

`bun pt …` (from the repo root; `apps/cli`) manages platform libraries through the admin app, so content packs go in without a database URL. Operators only.

```bash
bun pt login                          # local admin (http://localhost:3030), signs in through the browser
bun pt login prod https://<admin host> # once per server; later commands take --prod
bun pt libraries list
bun pt libraries push building/ramadan-packs/   # preview, confirm, write drafts; --publish to release
bun pt libraries pull ramadan-2026              # drafts and images as a pack folder
bun pt libraries publish ramadan-2026
bun pt libraries delete ramadan-2026            # refuses while sites follow it; --detach freezes their copies first
bun pt packs unzip pack.zip                     # pack zip → pack folder
```

Sign-in is OAuth (needs `OAUTH_CONSENT_COOKIE_SECRET` and `OAUTH_ALLOW_DCR=true` on the admin app) with the `pt.operator.libraries` scope; the routes under `/api/pt/admin/libraries` that accept it also check `users.is_admin` on every call. Tokens go to the macOS Keychain or `secret-tool`, else `~/.config/prayertools/credentials.json`. A pack's `key` matches it to its library ahead of the title, and `push` refuses to overwrite entries edited in the admin since the last push unless given `--overwrite`.

## Tests

```bash
bun run test     # shared unit tests, worker (test DB), public unit tests, marketing (test DB)
# admin API and public server end-to-end checks against running dev servers:
ADMIN_URL=http://localhost:2480 DATABASE_URL=… PUBLIC_URL=http://localhost:3480 ADMIN_DATABASE_URL=… bun run smoke
```

## Deployment

One image per process: `apps/<app>/Dockerfile`, built with the repo root as context. The public and worker images install only their own workspace's dependencies, plus the mail kernel fetched at the tag `layers.lock.json` pins; the public image ships just the Nitro `.output` on Node. Two DB URLs everywhere (`DATABASE_URL` BYPASSRLS, `APP_DATABASE_URL` RLS); the public server only needs the RLS one. PgBouncer in transaction mode is supported (`prepare: false`, GUCs are `SET LOCAL`). Behind a proxy, set `PT_TRUST_PROXY=true` on the public server so it reads the visitor's host and address from the forwarded headers; without it those headers are ignored.

## Mail

All mail goes through Nuxtinator's mail kernel (`@nuxtinator/mail`). Provider accounts, domains, the domain each stream sends from, and suppressions are managed on the admin app's **Admin → Email**; a site can send from its own domain once it proves it owns it. prayer.tools' streams are defined once in `@prayertools/shared/email/mail`:

| Stream | Carries |
|---|---|
| `confirmations` | links the person just asked for (verification, manage links, sign-in links, address changes); reaches even a suppressed address |
| `site` | a site's mail to its intercessors: reminders, welcomes, check-ins, thank-yous |
| `marketing` | site marketing, delivered from the marketing layer's own queue |
| `platform` | Prayer.Tools' notices to site teams and accounts |

The public server only queues mail on the kernel's outbox (`MAIL_OUTBOX_PUBLIC_KEY`); the worker and the admin app send it (`NUXT_SECRET_ENCRYPTION_KEY`, which must match). The env account (`MAILGUN_API_KEY` + `MAILGUN_DOMAIN`, or `MAIL_DOMAIN` with `MAIL_TRANSPORT=smtp` in development) must be identical in the admin app and the worker. Provider webhooks go to the URLs Admin → Email shows (`MAIL_WEBHOOK_SECRET` signs them); bounces and complaints land on the kernel's list, and a site's complaints also pause its marketing past the complaint-rate limit.

## Where this differs from the plans, or stops short

- **Nuxtinator upgrades are done here, not upstream.** The marketing layer lives in `apps/admin/apps/marketing`; the CRM "system actor" is a no-login system user; the consent log's wording/surface/source go in the CRM event `meta`.
- **Manage and unsubscribe links are signed tokens** (rotatable per subscription through `manage_version`, manage links expire after 400 days) rather than stored random tokens; verification, check-in and account codes (sign-in links, hand-offs, email changes) are random and stored hashed.
- **Admin UI is English only**; the public site ships five languages.
- **Site owners don't see the CRM's schema builder or permissions matrix.** `register-pt.ts` withholds `crm.schema.manage` from the `admin` role (core's `withholdFromAdmin`), so no one on a site holds it unless it is granted to them individually; operators included.
- **Accounts stop short in a few places.** App installs can't yet add an email to their account. Apple sign-in on the public server doesn't keep Apple's refresh token, so deleting an account from My prayer doesn't revoke it at Apple; an account whose admin app Apple sign-in holds one is kept until it is deleted in the admin app, which revokes it.
- **A crisis hands on within one site.** The 4-day crisis template's thank-you invites people to the next campaign on the same site, with `?from=<slug>` on the signup link so `joined_from` records it; a follow-up campaign on another site needs the champion's own button.
- **Not built:** the one-step 4-day → 12-day join (only `joined_from` is recorded), an operator cross-site inbox view (operators see only the conversations site teams send them as help requests, under Admin → Help requests), the cross-site "all my people" list (deferred: it would need cross-org reads), CI axe/RTL screenshot jobs and size budgets, the WordPress importer (legacy URL handling is in place).
- **Layers follow Nuxtinator's newest release.** No layer in `layers.ts` sets a `version`, so `layers:update` locks each one to its newest released tag (`layers.lock.json`), and the build fetches exactly those tags. A Nuxtinator change reaches the app once it is tagged and `/sync-layers` (or `bun run --cwd apps/admin layers:update`) commits the new lock; a push to Nuxtinator master alone ships nothing.
