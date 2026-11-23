# Prayer pages

The prayer page is where intercessors pray. It shows one entry of the campaign's prayer content, with an Amen button, a way to report praying as a group, a live count of people praying, and an invitation to share.

`/pray` shows the campaign's current entry and `/pray/<n>` shows entry `n`. Like the rest of the site, the path carries a language prefix for non-default languages and a campaign segment for campaigns other than the current one.

## Features

| Feature | What it does |
|---|---|
| [Prayer content](prayer-content.md) | Which entry a page shows, where its text comes from, day-to-day navigation, personal-start progress |
| [Praying now](praying-now.md) | "N people praying now" on the site |
| [Amen](amen.md) | "Amen — I prayed": marks the prayer finished |
| [Praying as a group](group-prayer.md) | Counts the prayers of a group praying together |
| [Sharing](sharing.md) | Share and copy-link buttons, referral links, share prompts |

## The page, top to bottom

1. Notices after signing up ("Please confirm your email" or the signup success message) or after confirming an email address.
2. The entry title (Day 3, Week 3, Month 3, or "Day 3 of 40" on personal-start campaigns), its date on dated campaigns, and a progress bar for a recognised subscriber on a personal-start campaign.
3. Previous / next links.
4. A link back to the campaign home, and the praying-now line.
5. The prayer content.
6. The Amen button and "Praying as a group? Tell us how many".
7. A signup card ("Get a daily reminder to pray", or "Pray through it one day at a time" on personal-start campaigns) and the "Invite others to pray with you" card.

## Prayer sessions

Praying now, Amen and the prayer statistics all come from prayer sessions. A session is one person praying one entry.

- The page creates a session id in the browser and stores it in localStorage, keyed by site, campaign and entry. Reloading or reopening the same entry within 3 hours continues that session, so it counts as one prayer.
- While the page is visible it pings the server every 30 seconds, and once more when the tab becomes visible again. A hidden tab doesn't ping, and neither does a page after Amen.
- The first ping creates the session row (`pt_prayer_session`) and counts one prayer in the campaign's daily `prayers` statistic, in the campaign's time zone. Opening the page is what counts the prayer, not Amen. For a recognised subscriber it also updates their personal totals and their last activity.
- Each later ping adds the time since the previous one to the session, at most 60 seconds per ping so time with the page closed isn't counted, and at most 2 hours per session. That time feeds the `prayer_seconds` statistic.
- A session can only be continued within 6 hours of its start.
- Each session records its source: `porch` for visitors, `manage` when opened from a personal reminder link, `app` for the mobile app.
- Raw sessions are kept for 24 months, in monthly partitions. Daily statistics are kept indefinitely.

The person behind a session is recognised from the personal token in a reminder link or from the manage cookie. The token rides in the URL fragment (`#p=…`), so it never reaches the server or the cache, and the page itself stays shared and cacheable. The page moves the token into session storage, so it lasts for that browser tab.

## Code

- Page: [PrayView.vue](../../../apps/public/app/components/views/PrayView.vue)
- View model: `prayPage` in [views.ts](../../../apps/public/server/utils/views.ts)
- Sessions: [prayer.ts](../../../apps/public/server/utils/prayer.ts) and the endpoints in [server/api/pray/](../../../apps/public/server/api/pray/)
- App API: [pings.post.ts](../../../apps/public/server/routes/v1/sites/[slug]/pings.post.ts), [amen.post.ts](../../../apps/public/server/routes/v1/sites/[slug]/amen.post.ts)
