# Sharing

Intercessors are the best way to find more intercessors, so the site invites people to share it.

## Where it shows

- **Prayer page:** the "Invite others to pray with you" card under the content.
- **Header:** a share icon on every page, except on archived sites, embeds and the admin editor.
- **Landing, signup, manage, not-started and between-campaigns pages:** their own share sections.

## The buttons

- **Share** opens the device's share sheet (the Web Share API). Where there isn't one, it opens WhatsApp with the message and link.
- **Copy link** copies the link and shows "Link copied".

The link points to the site's home, or for a side campaign, to that campaign's page. When the browser knows the sharer's referral code, the link carries it as `?r=<code>`. The browser learns the code when the person signs up on it (kept in localStorage per site), or from their signed-in account.

The message is the site's share message in the viewer's language, set in the admin under Landing page → Share. Without one, it's "I'm praying with {site}. Will you join me?".

## Share prompts

A modal, "Invite others to pray with you", appears:

- shortly after someone signs up, when no email confirmation is needed (on the landing and prayer pages)
- after they confirm their email
- after their third and seventh Amen on the site, counted per browser

Sites can turn these off with the setting "Invite people to share after they sign up and pray", which is on by default. The share buttons themselves stay.

## How it's counted

- Each share sends a `campaign_shared` analytics event with its channel (`native`, `whatsapp` or `copy`). These count toward the campaign's `shares` statistic and its breakdown by channel. A native share counts only when the person completes it. WhatsApp counts when it opens.
- Someone who signs up from a link carrying `?r=` is recorded as referred by the sharer, and counts toward `share_signups` ("people who joined through shares").

## Code

- [ShareButton.vue](../../../apps/public/app/components/ShareButton.vue), [SharePrompt.vue](../../../apps/public/app/components/SharePrompt.vue)
- Link and message: `shareUrl` and `shareText` in [useSite.ts](../../../apps/public/app/composables/useSite.ts); referral code in [useReferral.ts](../../../apps/public/app/composables/useReferral.ts)
- Counting: [collect.ts](../../../apps/public/server/utils/collect.ts)
