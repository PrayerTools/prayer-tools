# Admin app — `app.prayer.tools`

Where champions and their teams build and run sites and their campaigns. Everything a site shows or sends is authored here; nothing public is served from here.

## Users

- Champions and their team members
- Platform operators (cross-site support and oversight; curate platform libraries; approve directory listings; assign owners; read all stories; retry failed jobs)

## Stack

- Nuxtinator core + tenancy + the shared CRM, inbox, marketing and email provider layers + a prayer.tools layer; the tenant (org) is the site. See [architecture.md](architecture.md).
- Client-rendered SPA on a single origin. Never edge-cached (`Cache-Control: private, no-store` on the API).
- Owns the database migrations for the whole platform.
- Auth: Nuxtinator's sessions (a short-lived access token and a rotating refresh token) with password and forgot password for recovery; Google and Apple sign-in may be added.
- Nuxtinator gaps to close: i18n for the admin UI, rate limiting.

## Accounts and access

- **One site is the default.** Everything starts from one site: picking a site, its dashboard, emailing that site's subscribers, that site's contacts (Intercessors). Anything spanning several sites (multi-site sends) is a secondary action, never the default screen.

## Navigation

- **The rail is the only main navigation;** there is no app sidebar. Top to bottom:
  - for the current site: Dashboard, Campaigns, Content, Landing page, Intercessors (the CRM's contacts), Inbox, Email, Stats, Team, Settings;
  - after a divider: Library (the champion's personal library);
  - at the bottom: Admin, for operators only.
- Every rail entry means "this, for the current site". Switching sites is the header switcher's job; it says "Sites" and "New site", never "Organizations". The rail starts collapsed (Nuxtinator's default).
- **Sections with several pages use in-page tabs:** Content (prayer content, libraries); Landing page (page, signup form, stories, share); Email (emails, test emails and push); Settings (settings, domains); Library (images and blocks, templates).
- **One campaign at a time:** Content, Landing page, Share, Stats and Test emails edit the campaign chosen in a shared switcher (the campaign on the site's root address by default; the browser remembers a choice until that campaign ends). Opening a campaign from the campaign list chooses it. A site with one campaign shows its name instead of a switcher.
- **Multi-site sends are never in the rail or top-level navigation:** "Send to several sites…" is in the overflow menu of a site's Email list and on each Library template, and only when the user can send on at least two sites.
- **The CRM and the inbox keep their own in-page navigation.** Champions never see the CRM's schema builder or permissions matrix: `crm.schema.manage` is withheld from the `admin` role.

- One login; after login, **Your sites** lists every site the user belongs to: name, live address, role, status (draft / published / archived), the current or next campaign, and the people count. Pending invites show at the top; with no sites, the page starts onboarding. No subsites, no per-site logins.
- Per-site roles and invites from Nuxtinator's tenancy layer:
  - **Owner** — team, domains, sending identity, deleting the site, and everything an editor can do. A site can have several owners.
  - **Editor** — content, email, settings, and intercessors including their details.
  - **Translator** — edits the translations of content and custom sections, for teams that want a person rather than AI to translate.
  - **Viewer** — stats only, no personal data.
- The last owner can't leave or be demoted. Operator access across sites for support; when an owner leaves, an operator can make another member an owner.
- A team member sees only the sites they belong to. Sharing a site with someone gives them that site only, never the owner's other sites.

## Onboarding

Replaces today's flow (signup theme creating a subsite on another domain). Everything happens on `app.prayer.tools`, and a half-finished setup can be resumed.

1. **Account:** sign up / log in.
2. **What a site and a campaign are:** a short explanation before any form.
3. **About the site:** name, description, what it's for (place, people group, event); location for the prayed-for coordinates.
4. **Template and setup:** choose a template, then answer start, end, goal and cadence for the first campaign, each explained (see [campaign-setup.md](campaign-setup.md)).
5. **Address and languages:** slug (`{slug}.prayer.tools`, suggested from the name). The champion chooses which languages the site runs in and a default language. Custom domain can be added later.
6. **Content:** choose libraries from the catalog — the template's suggested libraries first, "See more" for the rest — filtered by cadence and language, preview, and use as-is or modify; or create content from scratch (see [libraries.md](libraries.md)).
7. **Landing page:** walks through the landing-page sections (see [public-server.md](public-server.md)), asking for content where needed; stories are optional.
8. **Look and publish:** branding, email identity, a launch checklist, and a preview link that opens on desktop or phone (choosing an RTL language shows the page right to left). Sites stay drafts until the champion publishes.

Keeps what today's flow does behind the scenes: Turnstile and a bad-words check on names and slugs, adding the champion to the staff org's CRM with mailing tags, and the `campaign_created` analytics event.

## What champions manage

- **Site:** name, slug, branding, email identity (from-name, reply-to, logo, signature). When a brand color is chosen, text on it is set to white or dark for contrast, with a warning if the color is too pale to be readable.
- **Status:** draft → published → archived (see [campaign-setup.md](campaign-setup.md)).
- **Campaigns:** create, schedule, relaunch (a new campaign on the same site), close. Each campaign has its setup: start, end, goal, cadence, and "track time committed" for people-mobilized campaigns (see [campaign-setup.md](campaign-setup.md)). Past campaigns keep their stats.
- **Languages:** the site's languages and default language, changeable any time. They drive:
  - the public site's language switcher and signup language options;
  - which languages content must exist in — the library catalog shows each library's language coverage, and missing translations can be filled with AI translation;
  - reminder and site emails, sent in each intercessor's language.
  The list of available languages lives in code; the site stores only its chosen subset and default.
- **End-of-campaign thank-you:** sent to everyone in the campaign when it ends, and in personal-start campaigns to each person when they reach the last day. The champion can add an optional message and call to action (button text + link) per campaign, with a preview.
- **Domains:** add a custom domain, see CNAME instructions and verification status (provisioned through Cloudflare for SaaS). `{slug}.prayer.tools` always works.
- **Prayer content:** libraries used directly or modified per entry, the site's own content, Tiptap editor, per language, AI-assisted translation (see [libraries.md](libraries.md)).
- **Libraries:** create their own, usable on all their sites; request sharing with everyone.
- **Personal library:** email templates, images and reusable blocks owned by the champion and usable on any of their sites (see [architecture.md](architecture.md)).
- **Landing page:** per campaign: fill in the sections, choose the hero image, add custom sections (heading, rich text, optional image and button), and optionally a stories section. The site's color and logo are edited there too and shared by all campaigns. A new main campaign starts from the latest main campaign's landing page.
- **Images:** uploaded to object storage and resized for slow connections; alt text required (AI-translatable); optional credit shown under the image; a focal point so the hero image crops well on phones. Uploads go to the champion's personal library, so an image can be reused on any of their sites.
- **Test emails:** "Send me a test email" on every email the site sends (reminder, end-of-campaign, check-in, verification, site emails), in any site language. Test emails never contain live personal links.
- **Translations:** per-site editable strings over code-owned defaults. Champion-written text (custom sections, custom consent options) is written in one language and translated into the site's other languages with an AI translate button; translations stay editable, and editing the original flags the other languages as out of date instead of overwriting them. No public "AI translated" label.
- **Intercessors:** the site's CRM contacts with their subscriptions and commitments; anonymous app intercessors appear as counts and activity only.
- **Custom signup fields:** up to about 5 (short text, dropdown or checkbox; required or optional; labels and options AI-translatable), stored as CRM custom fields on the site. Asked on web signup, and in the app once the person links an email. Answers show on the intercessor record and in exports and are never sent to analytics.
- **Export:** owners and editors download a CSV straight away: name, email, language, timezone, signup date, status, reminder times, custom answers, consent. Unsubscribed people appear without email or name; anonymous app intercessors aren't included. Every export is logged (who, when), visible to owners and operators.
- **Stats:** people signed up (every campaign), progress toward the goal (people, prayer time or coverage), commitments, prayer activity, praying now, people who joined through shares, per campaign.
- **Directory listing:** opt in; the site is listed after a Prayer.Tools operator approves it, and operators can unlist it. The site stays reachable by its link either way.
- **Communication:** site emails and push announcements (see Site email below).
- **Inbox:** contact messages and stories submitted from the public site arrive as threads (inbox layer), with status (new / replied / closed), assignment, internal notes and AI-drafted replies; the champion replies by email from the app and the reply is logged on the thread. Replies to site emails come back into the thread. A story whose writer allowed the site to publish it can be added to the landing page's stories section in one click; the name shows only if the writer allowed it. Operators get a cross-site view for escalations (privacy, safety, abuse).
- **Share** (after publishing): the site link (the custom domain once active), a QR code (PNG and SVG), editable share messages per language with WhatsApp sharing, and a share image also used for link previews.
- **Giving:** a card on the dashboard and a line on the Share screen link to the Prayer.Tools donation page.
- **Feedback:** the feedback widget (to the Prayer.Tools board) is on every admin page.

## Site email

The marketing layer (Doxa's marketing system — composer, Tiptap templates, audiences, senders, consent, one-click unsubscribe — ported to Nuxtinator), scoped to a site and built on the CRM.

- **Audiences:** the current campaign's intercessors, past campaigns' intercessors (re-engagement for a relaunch), everyone who consented, everyone who ticked one of the site's custom consent options. Consent is per site, so it carries across campaigns.
- **Before sending:** the confirm names the site and how many people the email reaches there ("Send to 1,240 people on Pray for Damascus?"); a multi-site send lists every site and its count.
- **Several sites at once** (a secondary action, see Navigation): a champion can write one email and send it to chosen audiences on several of their sites. Each person gets one email, from the most recently joined chosen site where they consented; unsubscribing stops updates from every chosen site they belong to (see [architecture.md](architecture.md)).
- **Templates and variables:** start from the champion's personal templates; variables (`{site name}`, `{campaign name}`, `{past campaign}`, `{site link}`, `{first name}`) are filled in per site.
- **Consent:** signup offers unchecked boxes for updates from this site and news from Prayer.Tools; reminders and transactional email come with joining. Champions can add their own consent options, with their own label. Every grant and withdrawal goes to the CRM's consent log (see [README.md](README.md)). Marketing only to people who opted in on that site. Prayer reminders are not marketing; unsubscribing from announcements never stops reminders. Bounce suppression is global per address.
- **Anonymous app intercessors** are reached by push, not email.
- **Reputation:** reminders and site marketing send on separate subdomains, so one site's bad send can't hurt reminders. Per-site throttling; marketing auto-pauses on high complaint rates.
- **Sending identity (leaning):** default is the platform domain with a per-site From name and address; replies go to the site's inbox (`<slug>@` the shared inbound domain), or to a reply-to the champion sets. Optional verified custom sending domain: the champion adds DKIM / SPF / DMARC records and the domain is registered with the email provider through its API. Per-site custom SMTP is not planned (loses bounce and complaint tracking; Workspace / Microsoft 365 daily limits stall large sends). Cloudflare Email Service can't send from champions' domains (the sender domain must be a Cloudflare zone in our account).

## Settings

Site and campaign settings follow code-owned defaults: only explicit overrides are stored; defaults and labels live in code and i18n.

## Open

- Grouping sites for partners who run many (e.g. many Ramadan sites) — not needed for v1.
- Sharing a personal library with specific people — deferred.
