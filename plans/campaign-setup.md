# Campaign setup

There are no campaign types. A campaign is described by four setup answers; templates pre-fill them, and display and behaviour follow from them. The options and defaults live in code; a campaign stores its answers. A relaunch starts from the previous campaign's answers and can change them.

## Setup answers

| Question | Options |
|---|---|
| Start | **on a date** (shared calendar, everyone on the same day) · **when each person joins** (personal start: each intercessor's day 1 is the day they sign up) |
| End | **on a date** · **no end** · for personal start: **how many days** each person goes through |
| Goal | **people mobilized** (preselected, recommended) · **prayer time** (e.g. 24 hours of prayer every day) · **24/7 coverage** (needs a start date and an end date) — offered in this order |
| Content cadence | daily · weekly |

## Length

- A shared-calendar campaign ending 50 days or less after its start displays as a **fixed** campaign.
- One ending more than 50 days after its start, or with no end, displays as **ongoing** (with or without an end date).

## Lifecycle

- **Site:** draft → published → archived. New sites start as drafts and are seen through a preview link until published. Archived sites show a short "this campaign has ended" page with no signup and no reminders, and can be un-archived. There is no paused state.
- **Campaign:** upcoming → active → ended, from its dates, never set by hand. Personal-start campaigns have no end date; each person finishes on their own.
- **Before a campaign starts** signup is open and reminders begin on the start date.
- **Between campaigns** the site shows the final results and the end-of-campaign call to action, and offers "Notify me when this campaign runs again" (the site-updates consent) in place of signup; those people are the audience for the relaunch invitation.

## Main and side campaigns

- A site runs one **main** campaign at a time; main campaign dates can't overlap. The current main campaign owns the site's root address.
- A **side** campaign runs alongside, e.g. Ramadan on a site with an ongoing campaign, so champions don't create a site per event. It may overlap any campaign and never becomes the current campaign.
- A side campaign needs a start date and an end date.
- It lives at `/{slug}` (signup, pray, stats and coverage under it). Its address comes from its name and year, e.g. `/ramadan-2027`.
- It has its own landing page: why text, custom sections, description and its own stories. Section headings, the signup form, consent options and branding are the site's.
- While it is upcoming or running, the site's landing page shows a card linking to it. Only the landing page does.
- Intercessors keep one subscription per site, with commitments in each campaign they join. There is no option to pause main-campaign reminders during a side campaign.
- Relaunching a side campaign keeps it a side campaign and copies its landing page.
- Site email audiences can pick any campaign by name, as well as the current main campaign and past campaigns.

## Goals and commitments

Signup is built around the reminder (Doxa model): the intercessor says when they want to be reminded, not when they sign up to pray.

| Goal | Days + time | Duration |
|---|---|---|
| People mobilized | required | asked only when the champion turns on "track time committed" (off by default); default 15 min |
| Prayer time | required | required, intercessor's choice; default 15 min |
| 24/7 coverage | required | required, whole slots only; default 15 min, raised to one slot |

- Daily means choosing a time; weekly or selected days means choosing the days and a time. There is no weekly without a day.
- The time is when the reminder is sent. Only for 24/7 coverage is it also the prayer slot that fills the coverage grid.
- One `commitment` row per prayer time. People mobilized counts distinct people with an active commitment, prayer time sums durations, 24/7 expands each row into slots.
- 24/7 campaigns also allow specific-date picks.
- 24/7 coverage needs a start date and an end date. A grid with no end can't be filled, and its percentage drops as days are added, so open-ended campaigns aim for prayer time instead.
- A 24/7 campaign chooses its slot length: 5, 10, 15 (default), 30 or 60 minutes. Durations are whole multiples of it, so every commitment fills complete slots.

## Counting people

Every campaign shows the number of people signed up, whatever its goal.

- **Web:** a person counts once their email is verified (by the email link, or by Google / Apple sign-in).
- **App:** a person counts once they join the campaign and create a reminder.
- Opening prayer content and "Amen" are tracked for stats; they don't decide who counts.
- **Fixed campaigns:** everyone who committed to the campaign, including those who have completed it.
- **Ongoing campaigns:** people with active commitments. The app inactivity sweep and email check-ins (see [README.md](README.md)) remove people who stop.

## End of a campaign

- **Shared calendar:** when the campaign ends, everyone gets the end-of-campaign thank-you with the champion's optional message and call to action (see [admin-app.md](admin-app.md)).
- **Personal start:** when a person opens the last entry, their subscription becomes `completed` and reminders stop; it never loops back to day 1. They get the same thank-you and call to action.
- The call to action is where a campaign hands people on, e.g. a 4-day crisis campaign's "Join the 12-day campaign".

## Templates

A template is a preset of the setup answers, an end-of-campaign call to action and the libraries it suggests (see [libraries.md](libraries.md)). Templates live in code; the champion never sees the word "type".

| Template | Start | End | Cadence |
|---|---|---|---|
| Generic | champion chooses | champion chooses | champion chooses |
| Ramadan | on a date | ~30 days | daily |
| Natural disaster — 4 day | on a date | 4 days | daily |
| Natural disaster — 12 day | on a date | 12 days | daily |
| Start anytime | when each person joins | the content's length (or a length the champion sets) | champion chooses |

All templates preselect the people-mobilized goal.

- **4-day → 12-day:** two separate sites. The 4-day campaign's end-of-campaign call to action links to the 12-day one; joining is one step (the person is known, their reminder time carries over, consent boxes are asked again), and the 12-day site records that they joined from the 4-day one.
- **Start anytime:** people sign up and start praying right away from the first entry, not the current day's. Without a set length, each person goes through every entry of the campaign's content (the longest library); adding entries lengthens it, also for people already praying.

## Content

- Content is a numbered sequence of entries (1…N) with a cadence. On a shared calendar, today's entry = campaign start + cadence.
- Public URLs address the entry number, so pages stay shared and edge-cacheable even for personal-start campaigns.
- **Personal start is paced by progress, like a devotional.** A person has one prayer time per campaign, which records how far they are. Opening the entry they are on (from a reminder link, the site in a browser they confirmed in, or the app) moves them to the next one, at most once per day (once per week for weekly campaigns) in their timezone. A missed day is not skipped: the next reminder sends the same entry. Reminders are skipped on a day they already moved forward, and drop to weekly after three unopened reminders in a row until they open one.
- Personal-start pray pages have no "Next" link. `/pray` takes a recognised subscriber to their entry and shows "Day N of M" with a progress bar; anyone else sees day 1 with an invitation to sign up.
- Personal start suits devotionals and crises where people should start praying right away, daily.

## 24/7 coverage and DST

24/7 coverage is used for fixed-date events in general, so DST must be handled.

- **Calculation:** the campaign is a grid of real slot instants (15 minutes unless the campaign chooses another length) from its start to its end (a DST day in the campaign's timezone simply has 92 or 100 15-minute slots). Each recurring commitment expands to occurrences by converting date + time in its anchor timezone to UTC; picks are instants already. Each occurrence marks the slots it overlaps. Coverage = share of slots with at least one intercessor. Because everything is in real instants, the result is exact across DST.
- **Where DST bites:** not the maths but the behaviour. A daily commitment anchored to the intercessor's local time moves by an hour in real time at their DST change, so the grid correctly shows a gap in one slot and a double in another. Anchoring to the campaign's timezone doesn't avoid it: the campaign's own change day skips or repeats an hour.
- **Specific-date picks are unaffected** — they are absolute instants.
- **Policy (leaning):** anchor recurring commitments to the intercessor's local time. The grid then shows where people will actually pray, so "real 24/7 coverage" is an honest claim; gaps created by a DST change show up on the calendar to be filled.
- **Alternative still worth considering:** anchor to UTC. Simpler and the grid stays full, but the intercessor's local time shifts by an hour, and people who keep their habit leave real gaps the grid doesn't show.
- **Rejected:** asking intercessors to choose — they shouldn't have to think about DST.
- **Calendar:** the same expansion gives coverage % per day (days in the campaign's timezone) and per-slot counts for the day view, as the current calendar shows.
- **Storage:** coverage is derived from the commitments, never stored as future rows. Short campaigns expand in memory on request and are cached briefly; long campaigns keep one slot-count array per campaign, updated when a commitment changes and rebuilt nightly.
- **Ramadan note:** with current rules no timezone changes offset during Ramadan 2027 through 2034, so Ramadan campaigns in those years never hit the policy question.

## Open

- Confirm the 24/7 DST policy (local-time anchor vs UTC).
- Whether an app commitment needs more than a reminder to count toward the people number.
- Whether a crisis campaign also needs dated updates everyone sees.
- Monthly cadence (WordPress supports it).
