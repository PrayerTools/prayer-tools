# Mobile app to-dos

The mobile app is not built yet and will be a separate codebase. This file lists what [USE_CASES.md](../USE_CASES.md) expects of the app that this repo's side of it (the app API under `/v1` on the `api.` host, and the worker's push notifications) can't do yet. None of it is needed until the app exists. The plan for the app is in [plans/mobile-app.md](../plans/mobile-app.md).

## 1. Thank-you push has no call to action

- **Use case:** "Everyone who took part gets a thank-you (email, and push in the app), with the champion's message and a call to action" (Close a campaign).
- **Code:** the thank-you email carries the champion's message and the next step. The push carries only the end message or a default text, and its data is the site, the campaign and the kind. The app API has no field for the next step, so the app has nowhere to fetch it after the push is opened.
- **Effect:** an app intercessor who prayed through a side campaign is thanked but never invited to the main campaign. App intercessors have no email, so the push is the only thank-you they get.
- **Where:** `pushText` and the `ctx.push` call in `apps/worker/src/jobs/thank-you.ts`; `packages/shared/src/next-step.ts`; `apps/public/server/utils/app-api.ts`.
- **Also:** when a start-anytime campaign ends, the campaign-wide push (`pushCampaign` in the same file) still includes app users who already finished it and got their personal thank-you, so they would be thanked twice. The email skips them by `finished_at`; the push needs the same filter.

## 2. No data download or deletion from the app

- **Use case:** "Download or delete their data" (Intercessor).
- **Code:** built on the web, from the manage link and My prayer. The app API has neither: `DELETE /v1/devices/me` removes only the device credential, not the account or its data.
- **Where:** routes under `apps/public/server/routes/v1/`; the web versions are `apps/public/server/api/my/export.get.ts` and `my/delete.post.ts`.

## 3. An app install can't add an email

- **Use case:** the app intercessor "may add an email later" (Intercessor (app)). The README also lists this as not built.
- **Code:** an app install is an anonymous account created by `POST /v1/devices`. Nothing in `/v1` attaches an email or a sign-in to it.
- **Effect:** an app-only account can't reach My prayer on the web, which needs an email to sign in, and can't be recovered on a new phone.
- **Where:** `apps/public/server/routes/v1/devices/`; `packages/shared/src/accounts.ts`.

## 4. No Google or Apple sign-in in the app API

- **Use case:** "Sign up on the web with email, Google or Apple, or in the app" (Intercessor).
- **Code:** Google and Apple sign-in work on the web (My prayer and the signup form). `/v1` has no equivalent, so the app can't offer them.
- **Where:** `apps/public/server/utils/social-sign-in.ts`.
