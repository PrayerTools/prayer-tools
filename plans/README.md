# prayer.tools v3 — plans

Rebuild of prayer.tools campaigns. Today: WordPress multisite + Disciple.Tools + the prayer campaigns plugin, one subsite per champion.

**This version: with orgs.** Each site is a Nuxtinator org, and the shared Nuxtinator layers (CRM, inbox, marketing email) provide contacts, conversations and campaign email. See [architecture.md](architecture.md). The alternative, a single-tenant build, is on the `no-orgs` branch.

## Goals

- **No subsites.** One login lists every site a champion works on; they manage all of them from one place.
- **Custom domain per site** via CNAME. `{slug}.prayer.tools` by default.
- **Scale.** Target 10,000 people praying per day; design and load-test for 10×.

## Terms

- **Site** — the long-lived thing that owns the URL and domains, team, branding, email identity, languages, landing page and subscribers.
- **Campaign** — a dated instance on a site (Ramadan 2025, Ramadan 2026): setup answers, dates, prayer content, goal, commitments, stats. Relaunching is a new campaign on the same site; past campaigns stay reachable.
- **Main and side campaigns** — a site runs one main campaign at a time (dates can't overlap), so its root address is unambiguous. A side campaign (Ramadan beside an ongoing campaign, a crisis response) runs alongside on fixed dates at its own address, `/{slug}`, with its own landing page (see [campaign-setup.md](campaign-setup.md)).
- Public pages show the site's current main campaign. "Site" is a word for champions; intercessors see campaigns.

## Components

| Component | Where | Plan |
|---|---|---|
| Architecture | tenancy, access, shared layers, person accounts | [architecture.md](architecture.md) |
| Admin app | `app.prayer.tools` | [admin-app.md](admin-app.md) |
| Public server | site domains, `api.prayer.tools`, `go.prayer.tools`, the My prayer page | [public-server.md](public-server.md) |
| Mobile app | iOS / Android | [mobile-app.md](mobile-app.md) |
| Hosting | DigitalOcean or Railway, behind Cloudflare | [hosting.md](hosting.md) |
| Migration | from the WordPress network | [migration.md](migration.md) |
| Campaign setup | start, end, goal, cadence, templates | [campaign-setup.md](campaign-setup.md) |
| Analytics | Statinator | [analytics.md](analytics.md) |
| Content libraries | shared and champion-made prayer content | [libraries.md](libraries.md) |
| Ideas | not planned, kept for later | [ideas.md](ideas.md) |

Admin app, public server, worker and a shared package (domain logic, types, email templates, i18n strings) live in one monorepo on one Postgres. The mobile app is its own codebase. The prayer.tools marketing site is a separate project.

## Foundations

- **Stack:** Nuxt 4, Nuxt UI 4, Postgres via Kysely. Admin app built on Nuxtinator (`corsacca/nuxtinator`): core + tenancy + the shared CRM, inbox and marketing layers + a prayer.tools layer (see [architecture.md](architecture.md)).
- **Shared layers:** improvements made for prayer.tools (email sending, deliverability, contact and inbox UI) are made in the Nuxtinator layers, so other Nuxtinator projects get them by bumping a version.
- **Open source.** Self-hosting is possible for people with hosting and development experience, but not supported.
- **Borrowed from Doxa campaigns-server** as patterns, not as a codebase: `FOR UPDATE SKIP LOCKED` reminder claim with lease, Postgres job queue, email provider layer with bounce/suppression handling, Tiptap content with AI translation, app inactivity sweep. Doxa's marketing email becomes the Nuxtinator marketing layer (see [architecture.md](architecture.md)).

## Access

- **Tenant = site**, a Nuxtinator org. The site's team are the org's members; roles are per site (see [admin-app.md](admin-app.md)).
- Every table holding a site's data carries the org and row-level security, so one site's team can never see another site's intercessors.
- **Two RLS scopes:** site scope (admin) and person scope (the intercessor app and the My prayer page, keyed by the person's user id).
- Work across several of a champion's sites (the sites list, the personal library, multi-site sends) is described in [architecture.md](architecture.md).

## Core data (sketch)

- `site` (the org), `site_domain` (hostname → site, verification status, Cloudflare hostname id), `campaign`
- **Account** — every person is a Nuxtinator user (`users`): an email signup creates an unverified account for a new address, an app install creates one with no address. The account owns the person's name and email address; it has app devices and sign-ins. Someone who prays and also runs a site is one account; they become a champion by creating a site (a membership).
- **Contact** — a CRM contact per site (CRM layer): language, custom answers, consent, notes, plus a copy of the account's name and email. The same person on three sites is three contacts, each linked to their account (`crm_records.user_id`) once the email is verified there. A change to the name or email on the account reaches every linked contact; champions can't edit them (they can email the person a sign-in link).
- `subscription` — a person on a site; points at the site's contact (web) and the account (`user_id`, once verified; always for app); delivery `email | app` (more channels can be added); status `active | inactive | completed | unsubscribed`
- **Consent** — the CRM's consent state and append-only proof log, per site: purpose key (built-in keys in code, or a site's custom option), grant / withdraw, the wording shown (i18n key + version, or a copy of a custom option's label), surface, source, time. "News from Prayer.Tools" is platform consent, held on a contact in the staff org's CRM.
- **Suppression** — global per address (hard bounce, complaint), owned by the email layer and checked on every send from every site.
- `commitment` — a recurring rule (or a list of specific dates for 24/7) within a campaign: days, time and timezone (always required; the time is when the reminder is sent), duration (required or optional depending on the goal, see [campaign-setup.md](campaign-setup.md)), `starts_on`, `ends_on`, and `next_reminder_utc` for email delivery. **No rows for future occurrences.**
- `prayer_session` — upserted per session from pings; partitioned monthly
- `reminder_sent` — email dedupe log
- Coverage computed from the rules (see [campaign-setup.md](campaign-setup.md)), cached briefly
- Settings follow code-owned defaults: the DB stores only explicit overrides; defaults and labels live in code / i18n

## Background work (worker process)

- **One global reminder sweep** over a partial index on `next_reminder_utc`, claimed with `SKIP LOCKED`, sent in parallel or via provider batch APIs. Cost follows due work, never site count. Reminder emails link to the day's prayer content; they never contain it.
- **Job queue** for fan-out work (end-of-campaign emails, marketing sends, imports, exports).
- **End of a campaign:** when a fixed campaign closes, every intercessor of that campaign gets a thank-you — email (via the job queue) and push for app users. Default text comes from code / i18n; the champion can add a message and a call to action. Not sent to `unsubscribed` or suppressed addresses.
- **Daily:** close ended campaigns; mark personal-start subscriptions `completed` when the person has reached the last day (reminders stop, and they get the end-of-campaign thank-you); delete web signups still unverified after 7 days (the verification rate is tracked through the `campaign_signup` and `campaign_signup_verified` events, see [analytics.md](analytics.md)); app inactivity sweep (30 days without activity per person × site → `inactive`, reactivated on activity; `unsubscribed` is sticky); stats refresh only for sites with recent activity; custom-domain health check (see [public-server.md](public-server.md)); data retention (below).
- **Email check-ins (web intercessors)**, from Doxa's follow-up scheduler. Activity = prayer sessions on that site.
  - A check-in email is due 30 days after the last activity (or signup), then every 90 days for later cycles.
  - It asks "Are you still praying?" with three buttons: *yes* / *sometimes* complete the cycle; *no longer praying* sets `unsubscribed`.
  - Any activity since the check-in completes the cycle without a reply.
  - No reply and no activity: one reminder after a week, and a week after that the subscription is set `inactive` (reminders stop).
  - Responses are kept as history on the subscription; admins can send a check-in manually.
  - Due check-ins are found with one set-based query, not a loop over every subscription.
  - Prayer content links in reminder emails identify the person, so praying from those links counts as activity.
- Nothing loops over every site. Set-based sweeps read across sites with the admin connection and explicit site ids; work that writes a site's data runs inside that site's org.

## Data retention

- Active, inactive and completed subscriptions are kept while the site exists (relaunch audience; inactive people can come back).
- Unsubscribed: 12 months after unsubscribing the subscription and its contact are anonymized (name, custom answers, reminder times removed); it remains as a count in stats.
- Archived sites: 12 months after archiving, their intercessors' personal data is anonymized; stats remain.
- An account with no subscription, linked contact, app device, membership, password, Google / Apple identity or live admin session is deleted with its email; a hashed address stays in the global suppression list only if it bounced or complained.
- Raw `prayer_session` rows older than 2 years are dropped by partition, once the site, campaign and per-person rollups hold everything shown (see [analytics.md](analytics.md)).
- Champions can't shorten these yet.

## Identity

- **Champions:** accounts on the admin app — Nuxtinator's JWT auth with password, recovered through forgot password. Google and Apple sign-in may be added.
- **Web intercessors:** email, verified by the email link, or Google / Apple sign-in (email already verified). Signing in to Prayer.Tools on a site with the same address also counts as verified. This is separate from the subscriber magic links used to manage prayer times.
- **Signing in:** every sign-in happens on `prayer.tools` (email link to the account's address). Its cookie is set for `.prayer.tools`, so every `{slug}.prayer.tools` site shares it; a custom domain and the admin app receive it through a one-time code. Public-server sign-ins are rows in `pt_account_session`, accepted only on the domain or custom host they were issued for, and never usable as an admin app sign-in. Every host under `prayer.tools` must therefore be served by prayer.tools itself, never pointed at another company's service (docs, status page, email click tracking).
- **My prayer:** a signed-in person sees their account (name, email change with confirmation), the campaigns they pray with across sites, past ones, and the sites they help run, with a way into the admin app and to start a new campaign (see [public-server.md](public-server.md)).
- **App intercessors:** anonymous first (Doxa model): an account without an address; email linking added later, which joins them to the same account as their web signups.
- Who counts toward the people number: see [campaign-setup.md](campaign-setup.md). Anonymous commitments count toward the campaign's goal while active. Champions see counts and activity for anonymous intercessors, never individual records; anonymous app intercessors are not CRM contacts.
- **Platform-wide unique people:** counted from accounts with a subscription (verified emails plus app installs).

## Open questions

- Sending identity for site email — leaning: platform domain by default, optional verified custom sending domain (see [admin-app.md](admin-app.md)).
- Setup answers (start, end, goal, cadence) live on the campaign, so a relaunch can change them — confirm.
