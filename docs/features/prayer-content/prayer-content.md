# Prayer content

Each prayer page shows one entry of the campaign's prayer guide: Day 3, Week 3 or Month 3, depending on the campaign's cadence.

## Where the text comes from

A campaign uses one or more libraries. Each library adds one block to the entry:

- A library that follows a platform library shows that library's current text for the entry. A frozen library, or the site's own library, shows the site's copy.
- With several libraries, each block gets the library's title as a heading. With one, the content shows without a heading.
- Each block is shown in the viewer's language, or in the site's default language when that translation is missing. A library with neither is left out.
- Placeholders in the text are filled for the site: `{site_name}`, `{campaign_name}`, `{place}`, `{in_place}`, `{of_place}`, `{people_group}`, `{start_date}`, `{end_date}`. This lets one library read naturally on many sites.
- An entry with no content shows "The prayer guide for this day is not available yet."

The landing page previews the start of today's entry: the first three paragraphs or other blocks of the first library.

## Which entries a visitor can open

`/pray` shows the current entry:

| Campaign | `/pray` shows | Entries a visitor can open |
|---|---|---|
| Dated, not started | "Prayer starts on {date}" | none |
| Dated, running | today's entry, in the campaign's time zone | 1 up to today's |
| Dated, ended | the last day's entry | all |
| Personal start | entry 1, or a recognised subscriber's own entry | all |

Admin previews can open every entry. An entry outside the range returns a 404.

## Previous and next

- Previous shows on every entry after the first.
- On a dated campaign, Next shows only once that entry's date has started in the viewer's own time zone. A viewer can be up to a day behind the campaign's time zone, and shouldn't be offered tomorrow's prayer early.
- After Amen, Next is offered again beside the thank-you.
- Personal-start pages never link ahead. Each person moves forward one entry at a time (see below).

## Personal-start campaigns

On a personal-start campaign everyone starts at entry 1 whenever they join, and moves through the guide at their own pace.

- A subscriber's commitment records how many entries they've done. Opening the entry they're on moves them forward, at most once per day in their own time zone (once per week on weekly campaigns, once per calendar month on monthly ones).
- When the page recognises the subscriber (see [Prayer sessions](README.md#prayer-sessions)), `/pray` takes them to the entry they're on. If they have already moved forward today, it takes them to the entry they prayed today.
- Their page shows "Day 3 of 40" and a progress bar. Once they've moved forward today, the next entry shows as "Day 4 opens tomorrow."
- Visitors the page doesn't recognise can read any entry, and see a card inviting them to sign up and receive the guide one day at a time.

## Code

- Entry range and content blocks: [content.ts](../../../apps/public/server/utils/content.ts), `dayContent` in [packages/shared/src/content.ts](../../../packages/shared/src/content.ts)
- Today's entry: `campaignView` in [site-data.ts](../../../apps/public/server/utils/site-data.ts)
- Personal-start progress: [packages/shared/src/progress.ts](../../../packages/shared/src/progress.ts), [position.post.ts](../../../apps/public/server/api/pray/position.post.ts)
