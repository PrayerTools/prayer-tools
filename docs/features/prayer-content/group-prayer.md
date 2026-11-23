# Praying as a group

Families, small groups and churches often pray through the guide together on one screen. "Praying as a group? Tell us how many" lets them report how many people prayed.

## What happens

- The button under Amen opens a number field: "How many people prayed together (including you)?" It starts at 2 and accepts 2 to 10,000.
- Send adds the number to the campaign's daily `group_prayers` statistic, in the campaign's time zone, and records the group size on the prayer session.
- The form is replaced by "Thank you! Your group's prayers are counted." It can be sent once per page view.
- It works independently of Amen, before or after it.
- It sends a `prayer_recorded` analytics event with the group size.

## How it's counted

Group prayers are a separate tally. The person's own prayer was already counted in `prayers` when the page opened, so `prayers` and `group_prayers` overlap and shouldn't be added together. Group prayers show as "Group prayers" in the public stats grid (once there are any) and on the admin stats page.

Reporting a group doesn't change [praying now](praying-now.md), which counts screens, not the people in front of them.

Only the web prayer page offers this; the app API has no group endpoint.

## Code

- `sendGroup()` in [PrayView.vue](../../../apps/public/app/components/views/PrayView.vue), [group.post.ts](../../../apps/public/server/api/pray/group.post.ts)
