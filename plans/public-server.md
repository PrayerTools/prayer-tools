# Public server — site domains and `api.prayer.tools`

Everything intercessors touch: sites, signup, prayer content, subscriber self-service, the My prayer page, and the API used by the mobile app. Server-rendered Nuxt app, separate from the admin app.

## Hosts it serves

- `{slug}.prayer.tools` for every site
- Champions' custom domains (CNAME → Cloudflare for SaaS fallback origin)
- `api.prayer.tools` — person-scoped JSON API for the mobile app and the manage page
- `go.prayer.tools` — short links, app deep links, QR targets
- `prayer.tools/my` — the My prayer page (see below)

Host middleware resolves the site from the hostname (`site_domain`), runs inside that site's org (see [architecture.md](architecture.md)) and serves the site's current campaign. `api.` and `go.` skip site resolution.

## Why a separate app

- Needs SSR for SEO, share previews and fast first paint on low-end phones; the admin app is an SPA.
- Serves thousands of hostnames; the admin stays on one origin so champion logins are never split across domains.
- Cache-everything at the edge vs. never-cache in admin, with simple per-host Cloudflare rules.
- Ships only what intercessors need; isolated from admin deploys and load.
- Admin endpoints don't exist on site domains; can use a narrower DB role.

## Pages

- Landing, signup and coverage, daily prayer content, stats, contact / stories — per campaign, per language
- Past campaigns reachable (e.g. `/2025/stats`)
- Side campaigns at their own address (e.g. `/ramadan-2027`), with their own landing page (see [campaign-setup.md](campaign-setup.md))
- Subscriber manage page (see below)
- Calendar feed (webcal subscription) and one-off `.ics`
- Embeddable signup / coverage widget for external sites (replaces the WordPress shortcodes)
- Before a campaign starts: signup is open and reminders begin on the start date.
- Between campaigns (the last campaign has ended, no new one yet): final results, the end-of-campaign call to action, and "Notify me when this campaign runs again" (the site-updates consent) in place of signup.
- Archived sites: a short "this campaign has ended" page; no signup.
- Drafts: reachable only through the champion's preview link, never cached.
- Footer: a "Give" link to the Prayer.Tools donation page.

## Landing page

Sections in a fixed order; the section list and defaults live in code, and the site stores only the champion's content, hidden sections and custom sections. Empty sections hide.

1. Top: name, image, people count or goal progress, signup button
2. Why this campaign (champion's text)
3. Custom sections and stories (optional; stories only when the champion adds them)
4. How it works
5. Signup
6. Today's prayer content preview
7. Share
8. Contact
9. Link to the mobile app, once the app exists

Templates set which sections show by default and pre-fill guidance text.

While a side campaign is upcoming or running, the site's landing page shows a card for it under the top section, linking to its own landing page. A side campaign's landing page has the same sections with its own content.

## Rendering and caching

- Shared pages (landing, prayer content, stats) are SSR and cached at Cloudflare; the origin renders roughly once per site × language × page × day.
- Personal pages and their API (`/manage/*`, the My prayer page) are `private, no-store` and bypass the cache.
- Coverage and stats come from precomputed aggregates, cached briefly at the edge.

## Signup (web)

- The signup page offers two ways in: sign up on the web, or use the app (store link / QR that deep-links into this site).
- Web signup uses email, verified by the email link, or Google / Apple sign-in, which gives an already-verified email. Apple's "Hide My Email" gives a relay address, so the same person typing their real email later becomes a second person.
- After signing up, the person lands on today's prayer content with a note to confirm their email. No reminders are sent until the email is verified; unverified signups are deleted after 7 days.
- An address already confirmed on the site, e.g. someone in the main campaign joining a side campaign, gets its chosen times by email: "Add these prayer times?", one button, valid 7 days, single use. Confirming adds them and lands on that campaign. A browser that already holds the address's manage cookie adds them at once. The form shows the same "check your email" message either way.
- Every commitment has days and a reminder time; duration depends on the campaign's goal (see [campaign-setup.md](campaign-setup.md)).
- On 24/7 campaigns each recurring prayer time is chosen on a coverage picker: the hours that most need someone are listed first, then a grid of the 24 hours shaded by how covered each is from now to the campaign's end (only the chosen weekdays for weekly), then the slots of the chosen hour. One line gives the numbers for the selected time ("still open on 12 of 30 days"). Specific dates are picked on the prayer calendar page. Other goals ask for a plain reminder time.
- Consent boxes, unchecked: updates from this site, news from Prayer.Tools, and any custom options the champion added.
- Turnstile and rate limiting on public endpoints.
- Creates or reuses the site's CRM contact by email, inside the site's org; a subscription on the site; commitments in the current campaign as recurring rules. The address's account is created (unverified) if there is none. Once the email is verified, the subscription and the contact are linked to that account. A person signed in to Prayer.Tools on the site who signs up with their account's address is verified at once.
- Contact channels and delivery are typed so SMS or WhatsApp signup can be added later.
- Custom signup fields added by the champion are asked on the web form.
- The page after signup invites people to share the campaign (see Sharing).

## Subscriber self-service (magic links)

- Links in emails point to the site's domain (custom domain once Cloudflare reports it active, otherwise `{slug}.prayer.tools`).
- First visit exchanges the token for an httpOnly cookie on that domain and redirects to a clean URL.
- Tokens: long random, stored hashed, scoped to one subscriber on one site, rotatable, optionally expiring with a "send me a fresh link" fallback. One-click unsubscribe (`List-Unsubscribe`) uses a separate narrow token.
- Manage: add / change / pause / remove prayer times, profile, language, timezone, unsubscribe, delete data, download my data (profile, reminder times, consent history and custom answers for this site).
- The manage page shows the current site only; a forwarded reminder email never opens the person's other sites. Its footer points to the My prayer page.
- Check-in responses: the three buttons in a check-in email (still praying / sometimes / no longer praying) land on a confirmation page on the site's domain, authenticated by the link token.

## My prayer (all sites)

One place where a person manages their account and every campaign they pray in.

- **Getting in:** "email me my link" on `prayer.tools/my`. The person types their address and the link goes to that address; the page always answers "if we know this address, we've sent a link", so it never reveals whether someone prays through prayer.tools. Opening the link verifies the account's address.
- **Nobody else can get in:** a site's team can have a sign-in link emailed to the person (from the intercessor's record), but it goes only to the account's address; codes are stored hashed, so neither champions nor operators can see one; test emails never contain live links.
- **Session:** the single-use code becomes a row in `pt_account_session` and an httpOnly cookie for `.prayer.tools` that the person can sign out of, shared by My prayer and every `{slug}.prayer.tools` site. Sessions are kept apart from core's `sessions`, so one can never be exchanged for an admin app sign-in.
- **Subdomain sites:** already signed in through the shared cookie (signup form filled in, prayer times reachable from the landing page and the manage page). Their "sign in" goes to `prayer.tools/my/continue`, which returns straight to the site.
- **Custom domains:** "sign in" goes to `prayer.tools/my/continue`, which returns with a one-time code for that host only; the site then has its own session, accepted on that host only. A site the person prays with or helps run gets the code straight away; any other site first asks them on My prayer to confirm signing in to it, since its owner's server then holds their sign-in. "Manage" and "Start a prayer campaign" open the admin app the same way.
- **What it shows:** the account (name; email change, confirmed from a link sent to the new address and then copied to every site), the sites the person helps run, and a card per site they pray with: current campaigns — reminder times (add, change, pause, remove), language, timezone, consent and unsubscribe for that site — and past campaigns with their own prayer totals. Download my data and delete my data cover every site.
- **Email change safety:** changing the address needs a sign-in from the last 15 minutes (otherwise a fresh email link first), and confirming the new address doesn't sign in whoever opened the link. The old address is told at once, with a link valid for 7 days that keeps or restores it, cancels pending changes, signs out every other session (public and admin) and removes the admin password, Google / Apple links and pending password resets.
- **Admin app:** the hand-off opens it only from a sign-in made in the last 24 hours; an older one asks for a fresh email link first. The admin session keeps that sign-in's time, so it counts as recently authenticated only as long as the sign-in does.
- **Cross-site writes:** every `*.prayer.tools` host is the same site to the browser, so non-GET `/api/*` requests must come from the host's own pages (`Sec-Fetch-Site: same-origin`, or a matching `Origin`).
- **Only verified emails:** a site's subscription appears only once the email was verified on that site, so a signup made with someone else's address never shows on the owner's page.
- **Scoping:** the page runs as the person (their user id); every change is applied inside that site's org, one site at a time.
- Apple "Hide My Email" relay addresses are a separate identity.

## API for the mobile app (`api.prayer.tools/v1`)

- Versioned and backward compatible — old app versions live for years. OpenAPI spec.
- Anonymous device registration issues a per-device credential and creates an account without an address (`intercessor_id` in the response is its id); email linking later.
- Subscriptions per site and commitments per campaign; each commitment is sent as its own rule (days, time, timezone, and duration when the goal uses it).
- Prayer session pings (upsert per session) feed "praying now" and activity.
- Prayer content as JSON (Tiptap) by site / campaign / day / language, edge-cacheable.
- "Amen" submissions carry a client-generated id; repeats are ignored, so offline prayers can sync later without double counting.
- Subscription status so the app can stop reminders for ended campaigns or inactive subscriptions.
- Directory: paginated search over sites that opted in and were approved by a Prayer.Tools operator.
- Report a site: goes to operators, who can unlist it.

## Domains and deep links

- Custom domains through Cloudflare for SaaS; provisioning is triggered from the admin app.
- Once a custom domain is active it is the canonical address (page tags, share links) and `{slug}.prayer.tools` redirects to it.
- A daily worker check reads each custom hostname's status from Cloudflare. If a domain stops pointing to us, the champion is emailed, the redirect stops and email links fall back to `{slug}.prayer.tools` until it's fixed.
- Takeover protection: a removed domain is deleted from Cloudflare immediately; a domain belongs to one site only; hostnames not in `site_domain` get a 404, never a default site.
- Moving a domain to another site: remove it from the first, then add and re-verify it on the second.
- Serves `apple-app-site-association` and `assetlinks.json` on `*.prayer.tools` and `go.prayer.tools`. Custom domains can't open the app (iOS needs domains at build time), so app-bound links always use prayer.tools hosts.

## i18n

- `@nuxtjs/i18n`; UI and template strings are AI-translated during development and committed with the code (25 locales today), RTL support. No Weblate and no translation screen.
- Per-site strings and prayer content come from the database.
- Dates, times and numbers are formatted per language with `Intl`.
- Each site serves only its chosen languages; the default language is used when a visitor's language isn't one of them.

## Sharing

- Share prompts: the page after signup ("Invite others to pray with you"), after the 3rd and 7th "Amen", the end-of-campaign thank-you, and a share button on prayer content pages.
- Sharing uses the phone's share sheet (WhatsApp on the web), pre-filled with the champion's share message in the person's language and the site link.
- Shared links carry a short code for the sharer (`?r=k3x9`). Signups through it are recorded as coming from a share; champions see totals only — nobody sees who invited whom, and there are no leaderboards.

## Stories

- Form: the story, an optional name, and an email (pre-filled when known). Submitting always sends it to the champion's inbox; Prayer.Tools staff can read all stories.
- Two unchecked boxes: "This story may be published by this campaign" and "Prayer.Tools may use this story in its communications". When either is ticked: use my name, or keep me anonymous (default anonymous).
- The permissions are stored with the story, with the version of the wording shown.

## Feedback

- The feedback widget (the Nuxtinator feedback layer's web component) is on every site page and goes to the Prayer.Tools board: bugs, ideas, problems with the site or app, unsafe content. It says so, pointing campaign questions to Contact.
- The site's contact form goes to the champion's inbox: questions about the campaign, typos in its content.
- Context attached automatically: site and campaign id, page and content day, language, browser or app version, the logged-in champion if any.

## Accessibility and performance

- Target WCAG 2.2 AA; Nuxt UI (Reka UI) components are accessible by default.
- CI runs axe on the landing, signup, prayer content, manage and My prayer pages in English and one RTL language, plus RTL screenshot comparisons.
- A size budget for each site page's JavaScript and images, reported in CI as a warning, not a failure.

## Analytics relay

Same-origin `/api/collect` and `/api/collect/heartbeat` on every site host (and `api.prayer.tools` for the app): record per-site stats, then forward to Statinator. See [analytics.md](analytics.md).

## Legacy URLs

Serves the WordPress URL shapes (manage magic links, `/prayer/fuel/` links, ICS feeds) for migrated sites and redirects to the new pages; any `fuel` URL redirects to its prayer content URL. See [migration.md](migration.md).
