# Mobile app

One app where an intercessor follows campaigns on several sites, each with one or more prayer times.

## Starting point

Copy the Doxa prayer app (`doxa-prayer-mobile-app`, Flutter, open source, copying permitted) to get started; it becomes its own codebase from then on.

## Kept from Doxa

- **Anonymous start** — pray immediately; server-minted identity, no login.
- **Local reminders** — repeating weekly notifications, one per distinct site × weekday × time. Commitments with app delivery never trigger server email.
- **Prayer sessions** — pings while praying (upsert per session) feed "praying now" and activity; "Amen" logs a completed prayer.
- **Native Tiptap rendering** of prayer content, with an offline file cache.
- **Several sites per device**, several reminders per site.
- **OneSignal** for push.
- **Server-side inactivity sweep** — 30 days without prayer on a site marks the subscription inactive; activity reactivates it; explicit unsubscribe is sticky.

## Changes for prayer.tools

- **Real schedules on the server.** Each reminder is sent as its own commitment rule (days, time, timezone, and duration when the campaign's goal uses it) so it counts toward the campaign's goal. A person counts toward the people number once they join a campaign and create a reminder. Doxa merges a group's reminders into one schedule and has no duration.
- **Per-device credential** issued at registration, stored in Keychain / secure storage (survives reinstall on iOS). No bundled app secret; no id that doubles as a bearer token or returns plaintext email.
- **Campaign lifecycle awareness.** The app refreshes campaign and subscription status on open; a silent push triggers rescheduling when a campaign ends or a subscription goes inactive, so reminders stop.
- **Timezone** re-sent when it changes.
- **Per-site** branding, stats, praying-now and campaign start dates (Doxa has one global start date).
- **Discovery** via deep links and QR (`*.prayer.tools`, `go.prayer.tools`) plus a paginated directory of operator-approved sites, with "Report this campaign" on each.
- **Server-sent push** (announcements, relaunch invitations) — built on the platform side.
- **Today screen:** the home screen shows a card per subscribed site with today's entry, the site's branding and whether it has been prayed today. A reminder notification opens its campaign and day directly.
- **After "Amen":** a pop-up asks whether to go home or pray the next subscribed campaign not yet prayed today (as in Doxa).
- **Language per site:** each subscription has its own language from that site's languages, defaulting to the phone's language when the site offers it, otherwise the site's default.
- **Offline "Amen":** saved locally with a unique id and sent when back online; the server ignores repeats. Offline praying skips the live pings and is recorded as one completed session on sync.
- **Share prompts** after the 3rd and 7th "Amen" and at the end of a campaign, through the share sheet.
- **Feedback form** posting to the same feedback backend as the web widget.
- **Give** link to the Prayer.Tools donation page in settings.
- **Sentry** for crashes and errors, tagged with app version and site id.

## Change at copy time

- Bundle ids, URL scheme, method channels, OneSignal app and app group, Firebase project, store listings
- API base → `api.prayer.tools/v1`, paths shaped around sites and campaigns
- Identity storage → secure storage with per-device credentials
- Associated domains → `*.prayer.tools`, `go.prayer.tools`
- prayer.tools branding for the app itself

## Later

- **Email linking** — adds recovery on a new phone, the web manage and My prayer pages, optional email reminders and each site's custom signup fields (which creates the person's CRM contact on that site); magic link that opens the app (no codes). Merging an anonymous account into an existing email account is a repoint of the user id.
- App Attest / Play Integrity if fake commitments appear.
