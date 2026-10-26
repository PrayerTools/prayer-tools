<script setup lang="ts">
// "Send me a test email" for every email the site sends, in any site
// language. Test emails never contain live personal links. Also push
// announcements to people who pray with the app.
import type { TranslatableText } from '@prayertools/shared/db/schema'

definePageMeta({ middleware: 'auth' })

const route = useRoute()
const { data: site } = usePtSite()
const { data: meta } = usePtMeta()
const toast = usePtToast()
const lang = ref('en')
watch(site, s => { if (s) lang.value = s.site.default_language }, { immediate: true })
const sending = ref<string | null>(null)

const EMAILS = [
  { kind: 'verification', title: 'Confirm your email', description: 'Sent right after someone signs up on the web.' },
  { kind: 'welcome', title: 'Welcome', description: 'Sent once someone confirms their email. Lists their prayer times with links to pray, add them to a calendar and invite others.' },
  { kind: 'reminder', title: 'Prayer reminder', description: 'Sent at each person\'s prayer time. Links to the day\'s prayer content.' },
  { kind: 'checkin', title: 'Check-in', description: 'Asks people who stopped praying in an ongoing campaign whether they want to continue.' },
  { kind: 'thanks', title: 'End-of-campaign thank-you', description: 'Sent when a campaign ends, with your message and call to action.' },
  { kind: 'manage', title: 'Link to manage prayer times', description: 'Sent when someone asks for a fresh link.' },
  { kind: 'contact', title: 'Contact form acknowledgement', description: 'Confirms a message sent from your contact form.' },
  { kind: 'story', title: 'Story acknowledgement', description: 'Thanks someone for sharing a story.' }
]

const push = reactive({ heading: null as TranslatableText | null, body: null as TranslatableText | null, sending: false })
async function sendPush() {
  push.sending = true
  try {
    const res = await $fetch<{ recipients: number }>('/api/pt/push', { method: 'POST', body: { heading: push.heading, body: push.body } })
    toast.ok('Announcement queued', `${res.recipients} app users will receive it.`)
    push.heading = null
    push.body = null
  } catch (err) {
    toast.fail(err, 'Could not send')
  } finally {
    push.sending = false
  }
}

async function send(kind: string) {
  sending.value = kind
  try {
    const res = await $fetch<{ sentTo: string }>('/api/pt/test-email', { method: 'POST', body: { kind, language: lang.value } })
    toast.ok('Test email sent', `Check ${res.sentTo}.`)
  } catch (err) {
    toast.fail(err, 'Could not send')
  } finally {
    sending.value = null
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6">
    <PtCampaignTabs
      v-if="typeof route.query.campaign === 'string'"
      :campaign-id="route.query.campaign"
    />
    <MarketingTabs v-else />
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">
          Test emails
        </h1>
        <p class="text-sm text-(--ui-text-muted)">
          See exactly what people receive. Site emails to groups of people are under Site email.
        </p>
      </div>
      <USelect
        v-model="lang"
        :items="(site?.site.languages ?? []).map(l => ({ label: languageName(meta, l), value: l }))"
        class="w-44"
      />
    </div>
    <UCard
      v-for="e in EMAILS"
      :key="e.kind"
    >
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="font-medium">
            {{ e.title }}
          </p>
          <p class="text-sm text-(--ui-text-muted)">
            {{ e.description }}
          </p>
        </div>
        <UButton
          label="Send me a test"
          variant="soft"
          :loading="sending === e.kind"
          @click="send(e.kind)"
        />
      </div>
    </UCard>

    <UCard v-if="site">
      <template #header>
        <h2 class="font-semibold">
          Announcement to app users
        </h2>
        <p class="text-sm text-(--ui-text-muted)">
          A push notification to everyone praying for this site with the Prayer.Tools app. People who use email get site
          emails instead.
        </p>
      </template>
      <div class="space-y-3">
        <PtTranslatableInput
          v-model="push.heading"
          :languages="site.site.languages"
          :default-language="site.site.default_language"
          label="Title"
        />
        <PtTranslatableInput
          v-model="push.body"
          :languages="site.site.languages"
          :default-language="site.site.default_language"
          label="Message"
          multiline
        />
        <div class="flex justify-end">
          <UButton
            label="Send to app users"
            icon="i-lucide-smartphone"
            :loading="push.sending"
            @click="sendPush"
          />
        </div>
      </div>
    </UCard>
  </div>
</template>
