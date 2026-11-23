# Praying now

"3 people praying now" tells intercessors that others are praying alongside them.

## Where it shows

- **Prayer page:** next to the campaign home link, whenever at least one person is praying. The viewer is one of them, so someone praying alone sees "1 person praying now". It refreshes with each ping, every 30 seconds.
- **Landing page:** in the hero, whenever at least one person is praying. The number is taken when the page is rendered.
- **Stats:** a "Praying now" tile in the public stats grid.
- **App API:** `praying_now` on the site endpoint and in each ping response.

Sites can turn it off with the setting "Show how many are praying right now", which is on by default. When it's off, the line and the tile are hidden and the site endpoint returns `null`.

## What it counts

The number of different people with a live [prayer session](README.md#prayer-sessions) on the site:

- **Per site.** It counts everyone praying on any of the site's campaigns, never other sites.
- **Live** means the session pinged in the last 90 seconds, started within the last 6 hours, and hasn't had Amen. A person drops out about 90 seconds after they close the page or hide the tab, and as soon as they press Amen.
- **People, not pages.** One person with several entries or tabs open counts once:
  - On the web, sessions from the same browser share a visitor key: an HMAC of the browser's analytics id (`pt_vid` in localStorage), keyed by the platform secret, the site and the UTC date. The key changes every day, so stored sessions can't be used to follow a browser from one day to the next.
  - In the app, sessions are matched by the person's account.
  - A session without either counts on its own.

Around midnight UTC the visitor key changes, so a person can briefly count twice: for up to 90 seconds, if they open another entry just after midnight while an earlier one is still live.

## Code

- Count: `prayingNow` in [packages/shared/src/stats.ts](../../../packages/shared/src/stats.ts)
- Visitor key: `visitorKey` in [prayer.ts](../../../apps/public/server/utils/prayer.ts)
- Ping: [ping.post.ts](../../../apps/public/server/api/pray/ping.post.ts), `ping()` in [PrayView.vue](../../../apps/public/app/components/views/PrayView.vue)
