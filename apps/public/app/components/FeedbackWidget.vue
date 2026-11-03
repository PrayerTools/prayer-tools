<script setup lang="ts">
import type { FeedbackView } from '~~/shared/view'

// The Prayer.Tools feedback widget (Nuxtinator feedback web component) with
// context about the page it was opened on.
const props = defineProps<{ feedback: FeedbackView, context?: Record<string, string> }>()
const route = useRoute()
const { t } = useI18n()

const config = computed(() => JSON.stringify({ profile: 'chat-bubble', instanceId: 'fb-1', projectId: props.feedback.projectId, apiBase: props.feedback.apiBase, enabled: true, showByDefault: true }))

// The component takes no context field, so the page context rides along as
// data attributes on the slot.
const attrs = computed(() => ({
  ...props.context,
  'data-page': route.path,
  'data-browser': navigator.userAgent,
  'title': t('feedback.intro')
}))

onMounted(() => {
  if (document.querySelector('script[data-pt-feedback]')) return
  const s = document.createElement('script')
  s.src = props.feedback.scriptUrl
  s.defer = true
  s.dataset.ptFeedback = '1'
  document.head.appendChild(s)
})
</script>

<template>
  <div class="feedback-widget-slot" v-bind="attrs">
    <feedback-web-component :profile-config="config" />
  </div>
</template>
