# Amen

"Amen — I prayed" sits at the end of the prayer content. Pressing it closes the prayer.

## What happens

- The button changes to "Thank you for praying!", with a link to the next entry when there is one (see [Previous and next](prayer-content.md#previous-and-next)).
- The [prayer session](README.md#prayer-sessions) is marked completed. The page stops pinging, so no more prayer time is added, and the person drops out of [praying now](praying-now.md) right away.
- The browser remembers the Amen with the session. Reopening the same entry within 3 hours shows the thank-you instead of the button.
- For a recognised subscriber, the contact's activity in the admin shows the prayer as "prayed", alongside the "opened" event from when the page opened.

Amen doesn't count the prayer. The prayer was counted when the page opened, so people who pray without pressing Amen are still counted.

## Share prompt

The third and seventh Amen on a site, counted per browser, open the share prompt ("Invite others to pray with you"), unless the site has turned share prompts off. See [Sharing](sharing.md).

## In the app

The app sends Amen with its own session id. If the app pinged that session, Amen completes it. If not, for example because the person prayed offline, Amen records a finished prayer at the time the person prayed, with the time they spent, and counts it. Repeats of the same id are ignored, so prayers synced later aren't counted twice.

## Code

- Web: `amen()` in [PrayView.vue](../../../apps/public/app/components/views/PrayView.vue), [amen.post.ts](../../../apps/public/server/api/pray/amen.post.ts), `markAmen` in [prayer.ts](../../../apps/public/server/utils/prayer.ts)
- App: [routes/v1/sites/[slug]/amen.post.ts](../../../apps/public/server/routes/v1/sites/[slug]/amen.post.ts)
