# Migration from WordPress

Source: the WordPress multisite (Disciple.Tools theme + `disciple-tools-prayer-campaigns` plugin, one subsite per champion, production on `*.prayer.tools` and `*.pray4movement.org`).

## Strategy

- **Sites on the prayer.tools WordPress server move in one cutover.** The DNS setup can't serve WordPress subsites and v3 subdomains on prayer.tools at the same time.
- **Rehearse on staging** (a different domain) with full production backups (SQL dump + `wp-content`): run the importer, compare the report against WordPress, run the acceptance checks, fix, repeat until clean.
- **Cutover:** put WordPress in maintenance mode (its reminders stop) → take a backup (SQL dump + `wp-content`) → import into v3 → switch the prayer.tools DNS and a wildcard `*.pray4movement.org` record to v3 (the bare `pray4movement.org` and `www` stay on the P4M site) → run the acceptance checks against the live domains. Pick a quiet time, well clear of Ramadan.
- Reminders due during the maintenance window are skipped; v3 resumes with the next ones. Only campaigns still running send reminders; ended campaigns are imported with `ended_at`, so the end-date sweep sends no thank-you. Check-in cycles start at the import.
- Campaigns can still be created in WordPress until the cutover, possibly with a warning that a migration is coming.
- **Champions** are told in advance what the migration involves, and emailed before and after. Passwords don't carry over (WordPress's phpass and pre-hashed bcrypt don't match v3's bcrypt check): champions sign in with Forgot password, or Google / Apple when the address matches. The email after the cutover links to Forgot password with their address filled in.
- **Rollback:** the WordPress server keeps running with email disabled, so DNS can be switched back if something goes badly wrong.
- **Sites on other servers** with their own custom domains are imported one at a time from their own databases: maintenance mode → import → the champion points their domain at the Cloudflare for SaaS fallback origin → acceptance checks.
- **The WordPress plugin** is maintained for a while with security fixes only.

## Importer and checks

- The importer (`scripts/wp-import/`) reads the SQL dump loaded into MySQL / MariaDB and the backup's `wp-content` (uploads, plugins). It is re-runnable: recreate the database and run again, or `--replace` re-imports chosen subsites. It writes a report comparing both systems: subscribers, commitments, content entries per language, stories, stats, totals, and what it skipped and why.
- Site rows are written on the RLS role, so a person is matched to contacts on their own site only.
- `--send-confirmations` queues the new confirmation emails (see subscriptions); only the cutover run passes it, so rehearsals email nobody.
- Acceptance checks (`scripts/wp-import/check.ts`) run against the public server after each import, per site: the home page and campaigns load; sampled prayer content days load, show their WordPress title, and every file on them loads from v3 storage with none left on the WordPress server; sampled old manage and fuel links open the right pages, and an unknown key is refused; the old address, `/list`, `/contact-us` and `?lang=` redirect; confirmed subscribers, prayer content days and stories match WordPress; and no reminder is due for an ended campaign, a paused prayer time or an unconfirmed subscription. It prints a pass / fail line per site and writes a report.
- Subsites WordPress marks archived or deleted are imported as archived sites, with content and stats; their addresses show v3's archived page.
- A subsite holding several campaigns (e.g. Ramadan 2025 and 2026) becomes one site with all of them. A dated campaign overlapping an earlier main campaign becomes a side campaign. An open-ended one stays a main campaign; v3 shows the running main campaign that started last.
- Campaigns overlapping an open-ended one that have no subscribers and no prayer content aren't imported, since they'd only compete to be the home campaign. When all of them are empty, the one WordPress showed on the home page (`dt_campaign_selected_campaign`) stays.
- A site's address is its subdomain name; the same name on pray4movement.org as on prayer.tools gets `-p4m`. A site's WordPress address, when it isn't the site's own (every pray4movement.org subsite), is recorded as an alias (`pt_site_alias`): the public server redirects a request to it, with its path and query, to the same path on the site's address.
- The subsites served on `ramadan.prayforniger.org` and `ramadan.praymorocco.com` live at their prayer.tools addresses; those custom domains aren't carried over.
- Not imported: the D.T contact records on each site, and story or contact comments in formats the importer doesn't know (5).

## Importer scope

| WordPress | v3 |
|---|---|
| Subsite + `campaigns` posts | site (org) + campaigns. 24/7 campaigns with an end date → coverage with `min_time_duration` as the slot length; "custom hours a day" or no end date → prayer time (`goal_quantity` hours a day as minutes, 24 by default). `prayer_fuel_frequency` → the cadence (daily, weekly or monthly); a monthly campaign starts on the 1st of its month and aims for prayer time, since monthly campaigns have no 24/7 grid. Ramadan landing type → Ramadan template. Location → place name and coordinates. |
| Champion users | verified accounts without a password + membership: administrator, dt_admin, campaigns_admin, porch_admin → admin; marketer → mobilizer; other roles → editor. Network super admins → operators, and members only of the sites where they hold a role (their WordPress "My Sites"). |
| `subscriptions` posts, contact email, timezone, language | CRM contact on the site (verified status kept) and one subscription per person per site (repeat signups for later campaigns merge into it). WordPress "inactive" → unsubscribed. Subscriptions without an email (data deleted) are skipped. Prayer times of subscriptions with reminders turned off (`receive_prayer_time_notifications` `0` or empty) come across paused. |
| Custom signup questions (subscription fields on the signup form, `dt_field_customizations`) | signup fields (text, dropdown, checkbox) with their translations and CRM field `pt_<key>`; each subscriber's answer on their contact |
| People groups (`peoplegroups` records on the site, not linked to a campaign) | the campaign's people group, when the campaign has no `people_name`: the site's people group names as one list |
| Unconfirmed (pending) subscriptions | skipped, unless the address is confirmed on the same site (merged) or signed up in the last 7 days: imported unconfirmed, with their confirmation window starting at the import and a new confirmation email |
| Prayer times (`dt_reports`) | built from the per-time rows, which are what WordPress reminded people about and counted (see below), not from the rule rows |
| Marketing opt-ins | "News from Prayer.Tools" (`receive_prayer_tools_news`) → consent on the staff org with source `WordPress import` for confirmed addresses, requested for unconfirmed ones; existing consent is kept |
| `landing` prayer fuel posts per day / language (HTML with Gutenberg blocks) | prayer content per campaign / day / language (see below) |
| Campaign meta + `dt_translations` | landing page, email texts and site strings (see below) |
| Stories, contact-us comments | inbox threads (see below) |
| Magic keys | manage and personal fuel keys stored hashed so old links resolve. WordPress had no calendar feed keys: its calendar was a download from the manage link. A fuel post's own key never opened a page. |
| `wp_praying`, fuel counts, subscriptions | daily stats (see below) |
| `p4m_participation` | directory entries (see below) |

## Prayer times

WordPress saves a recurring rule as a rule row plus one row per prayer time (tagged with the rule's id), and times picked one by one as rows without a rule. Its reminders and coverage read the per-time rows, which drift from the rule when a person removes one time, changes the time (only future rows move) or deletes the rule (only future rows go).

- A rule's rows split into runs of one local time with no missing day; each run becomes one recurring commitment (daily or weekly, from its first to its last day). The last run of a rule that still exists may run on to the campaign's end, or stay open in an ongoing campaign. Rules deleted in WordPress are rebuilt from their remaining rows and end on their last day; rules with no rows are dropped.
- Picked times: days in a row at one time of day → a daily commitment; the same weekday week after week → weekly (several weekdays merge into one commitment when that holds exactly the same times). The rest become one date list per person and campaign, in 24/7 campaigns only; in other campaigns they are reported. Picked times one of the person's rules already holds are dropped.
- Monthly campaigns remind monthly only: a weekly time becomes the first of that weekday each month and a daily one the 1st, at the same time of day; times that become the same merge. Picked dates in them are reported, since there is no 24/7 grid to hold them.
- Durations round up to the lengths v3 offers (whole slots in 24/7 campaigns).

## Prayer content

- Only what WordPress shows: published or scheduled posts with `linked_campaign` and `day`, whose campaign still exists. Drafts, private posts and posts without a campaign or day are skipped.
- A post without `post_language` is English.
- A day with several posts in one language becomes one entry with all of them, newest first, each under its title; exact copies are dropped.
- Converted to Tiptap with what the content editor supports: headings, lists, verses, tables, columns, text colour, highlight, superscript / subscript, images (with their link), audio and video. Google Maps embeds become a "View map" link; embeds with no v3 equivalent (Spotify, Google Drive, WordPress post embeds…) are dropped and reported.
- Each campaign gets its own site library with these entries.
- Entries numbered past their campaign's last day (often the day after Ramadan, or content longer than the campaign's dates) are imported but not shown; the report lists them per campaign.

## Images and files

- Images, audio and linked files whose URL is on `prayer.tools` or `pray4movement.org` (any subdomain), or on the custom domains that served subsites on the same server (`ramadan.prayforniger.org`, `ramadan.praymorocco.com`), are copied to object storage, and the imported content points at the copy. Anything on another host keeps its URL.
- The importer reads the files from the backup's `wp-content`: a URL's `/wp-content/uploads/sites/<N>/…` path is the file's path there, and `/wp-content/plugins/…` files come from the plugins folder. When the URL names a size WordPress generated (`-300x200.jpg`, `-scaled.jpg`), the original is used, else the named file, else the largest other size.
- Images are stored the way library images are: one WebP of up to 1600 px, named by a hash of the source, so an image used on many subsites, or met again on a re-run, is stored once. Audio and other files are stored as they are, named by a hash.
- Campaign hero, share images, the site logo and the email logo are copied the same way.
- A campaign with no header image (`header_background_url`) gets the plugin's stencil header, which WordPress showed in its place. It is stored once and shared; the directory doesn't use it as a site's picture.
- A campaign that switched off the header overlay (`enable_overlay_blur` = `no`) shows its hero image without the brand-color tint.
- The report lists referenced files missing from the backup.

## Landing page and email texts

WordPress keeps each text on the campaign in the campaign's language, and its other languages in `dt_translations`. The old `dt_campaign_porch_*` site options were copied into those by the plugin and are not read. Texts equal to the plugin's defaults aren't imported.

| WordPress | v3 |
|---|---|
| `subtitle` | campaign subtitle and description, with translations |
| `vision`, `pray_section_*`, `movement_section_*`, `time_section_*` | the campaign's "why" section as WordPress showed it in each language: the vision, then three headings with text, each the champion's text or the plugin's default (the "with prayer" and "Together" wording on `quantity` campaigns). On Ramadan sites an unchanged vision isn't stored: it is the Ramadan template's standard "why" text. |
| `promo_video_url` | a video at the end of the "why" section |
| `what_content` | the campaign's about section, when the champion wrote it (not lorem ipsum, not the Ramadan default, which is the Ramadan template's standard about text). Outside Ramadan sites its first heading becomes the site string `landing.about.title`. |
| `footer_content` | a custom section at the end |
| `vision_title`, `prayer_fuel_title` | site strings `landing.why.title`, `landing.today.title` |
| `country_name`, `people_name` | place name (when the campaign has no location) and people group |
| `from_name` | site sender name |
| `reply_to_email`, else `from_email` | site reply-to. v3 sends from the platform mail domain, so `from_email` isn't the sender. |
| `email_logo`, `logo_url` | site email logo and site logo |
| `email_signature` | site email signature |
| `custom_theme_color`, else a preset `theme_color` (forestgreen, green, orange, purple, teal) | site color, from the home campaign (`dt_campaign_selected_campaign`) as WordPress showed it at the site's root, else the most recent campaign with one. The plugin's default theme (`preset`, also used when a campaign set none) is its blue `#4676fa`, as WordPress showed it. |
| `email_tagline`, `signup_content`, `reminder_content` (and older `campaign_strings`) | the campaign's email text: tagline and note in the welcome email, note in reminders |

- Site-wide values (strings, sender, logos, signature) come from the most recent campaign that set them, main campaigns first.
- Not imported, and reported: campaign name translations (v3 campaign names aren't translatable), `prayer_fuel_description`, `logo_link_url`, Facebook / Instagram links, `reminder_content_disable_fuel`.

## Stories and messages

- Stories (`stories` comments on the campaign) → the person's contact, an inbox thread (source `story`) at its original date, and a `pt_story` on the campaign. WordPress never asked to publish, so publishing stays off (wording version `wordpress-import`). A story's name comes from the person's subscription; addresses WordPress cut short (`ann@yahoo`) are matched to the one subscriber address that starts with them.
- Contact-us messages (`contact_us` comments) → an inbox thread (source `contact_form`) from the name and address in the comment.
- Imported threads are closed, so inboxes don't fill with old messages already answered by email; a reply reopens one.
- Skipped: the copies of both on subscriptions, the `email` comments (a log of emails champions sent), system notes, `wp_campaign_messages` (copies) and `wp_campaign_signups` (UTM tags).

## Stats

Each count lands on its day in the campaign whose dates hold it, or on the site when none does.

- `prayers`: each `wp_praying` row (prayer sessions from the "praying together" call, since 2025-03), matched to a site by its page's host; and the 2023 fuel rows without a count.
- `group_prayers`: the fuel "how many prayed with you" counts.
- `signups` (and `verifications` once confirmed): one per WordPress subscription, on the day it was made.
- `stories`: one per imported story.
- Prayer seconds, page views, visitors and shares weren't stored in WordPress. Network totals (the `wp_praying` counter, the P4M dashboards) are sums of these per-site stats in v3's operator views.

## Languages

- WordPress locales map to v3 codes (`fr_FR` → `fr`). Tamil, Telugu, Kannada, Tagalog, Wolof and Slovenian, which sites have content in, are in v3's language list.
- Languages sites switched on without content (Gujarati, Hausa, Hebrew, Somali, Embu…) are dropped from site languages and reported; their subscribers get the site's default language.

## Directory

The directory and its approvals live on the separate prayer.tools site. Every imported site except those that opted out (`p4m_participation` off) gets a `requested` directory entry with its current campaign's description and image; operators approve them in v3.

## Links that must keep working

- Subscriber manage magic links (`/subscriptions_app/manage/<key>`)
- Personal prayer content links (`/prayer/fuel/<key>`)
- Campaign URLs: `/{campaign_url}/` and `/stats` are v3 shapes, since campaign slugs are the old `campaign_url`s
- `/{campaign_url}/fuel/<day>` → `/pray/<day>`; `/list` and `/listEdit` → `/pray`; `/contact-us` → `/contact`
- `?lang=<WordPress locale>` → the `/<language>/` prefix when the site offers that language
- Any of these on a pray4movement.org subsite's old address, through its alias

The public server serves these URL shapes for migrated sites and redirects to the new pages.

## Open

- **Sites on other servers:** the importer reads the multisite only; single-site WordPress installs (no `blogs` table, other table names) aren't supported yet.
