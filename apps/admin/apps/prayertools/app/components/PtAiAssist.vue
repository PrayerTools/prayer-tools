<script setup lang="ts">
// AI checks on the entry being edited: sensitive details with suggested
// replacements, and a review with suggested edits and Scripture. Each change
// is applied to the editor only when the champion accepts it.
import {
  REVIEW_CHECKS, REVIEW_CHECK_LABELS, SENSITIVE_KIND_LABELS, appendNodes, applyEdit, applyReplacement, verseNode, versesWithoutText,
  type EntryReview, type ReviewVerdict, type SensitiveFinding
} from '@prayertools/shared/prayer-ai'
import type { TiptapDoc } from '@prayertools/shared/db/schema'

const props = defineProps<{
  campaignId?: string
  lang: string
  checkOnOpen?: boolean
}>()
const doc = defineModel<TiptapDoc | null>({ default: null })
const toast = usePtToast()

const checking = ref(false)
const findings = ref<SensitiveFinding[] | null>(null)
const reviewing = ref(false)
const review = ref<EntryReview | null>(null)
const inserting = ref<string | null>(null)

const current = (): TiptapDoc => (doc.value ?? { type: 'doc', content: [] })
const emptyVerses = computed(() => versesWithoutText(current()))

async function checkSensitive() {
  checking.value = true
  try {
    const res = await $fetch<{ findings: SensitiveFinding[] }>('/api/pt/content/ai/sensitive', { method: 'POST', body: { campaignId: props.campaignId, lang: props.lang, doc: current() } })
    findings.value = res.findings
  } catch (err) {
    toast.fail(err, 'Could not check for sensitive details')
  } finally {
    checking.value = false
  }
}

async function runReview() {
  reviewing.value = true
  try {
    const res = await $fetch<{ review: EntryReview }>('/api/pt/content/ai/review', { method: 'POST', body: { campaignId: props.campaignId, lang: props.lang, doc: current() } })
    review.value = res.review
  } catch (err) {
    toast.fail(err, 'Could not review the entry')
  } finally {
    reviewing.value = false
  }
}

onMounted(() => {
  if (props.checkOnOpen) checkSensitive()
})

function notFound() {
  toast.fail(new Error('That text is no longer in the entry. Change it by hand if it is still needed.'), 'Nothing changed')
}

function acceptFinding(f: SensitiveFinding) {
  const res = applyReplacement(current(), f.text, f.replacement)
  if (res.count) doc.value = res.doc
  else notFound()
  findings.value = findings.value?.filter(x => x !== f) ?? null
}

function dismissFinding(f: SensitiveFinding) {
  findings.value = findings.value?.filter(x => x !== f) ?? null
}

function acceptEdit(e: EntryReview['edits'][number]) {
  const res = applyEdit(current(), e)
  if (res.count) doc.value = res.doc
  else notFound()
  dismissEdit(e)
}

function dismissEdit(e: EntryReview['edits'][number]) {
  if (review.value) review.value = { ...review.value, edits: review.value.edits.filter(x => x !== e) }
}

async function insertPassage(p: EntryReview['passages'][number]) {
  inserting.value = p.reference
  try {
    const res = await $fetch<{ text: string, reference: string, translation: string }>('/api/pt/scripture', { query: { ref: p.reference } })
    doc.value = appendNodes(current(), [verseNode(res.reference, res)])
    dismissPassage(p)
  } catch (err) {
    toast.fail(err, 'Could not look up the passage')
  } finally {
    inserting.value = null
  }
}

function dismissPassage(p: EntryReview['passages'][number]) {
  if (review.value) review.value = { ...review.value, passages: review.value.passages.filter(x => x !== p) }
}

const VERDICT_UI: Record<ReviewVerdict, { icon: string, class: string, label: string }> = {
  good: { icon: 'i-lucide-circle-check', class: 'text-(--ui-success)', label: 'Good' },
  partly: { icon: 'i-lucide-circle-dot', class: 'text-(--ui-warning)', label: 'Partly' },
  missing: { icon: 'i-lucide-circle-x', class: 'text-(--ui-error)', label: 'Missing' }
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        size="sm"
        variant="soft"
        icon="i-lucide-shield-check"
        label="Check for sensitive details"
        :loading="checking"
        @click="checkSensitive"
      />
      <UButton
        size="sm"
        variant="soft"
        icon="i-lucide-message-square-text"
        label="Review with AI"
        :loading="reviewing"
        @click="runReview"
      />
      <InfoTip text="AI suggestions only change the entry when you accept them, and nothing is saved until you save." />
    </div>

    <UAlert
      v-if="emptyVerses.length"
      color="warning"
      variant="subtle"
      icon="i-lucide-book-x"
      :title="`No verse text for ${emptyVerses.join(', ')}`"
      description="The lookup didn't find it. Add the text in those Scripture blocks, or remove them, before saving."
    />

    <div
      v-if="findings"
      class="rounded-md border border-(--ui-border) p-3 space-y-2"
    >
      <div class="flex items-center justify-between gap-2">
        <h4 class="text-sm font-semibold">
          Sensitive details
        </h4>
        <UButton
          icon="i-lucide-x"
          size="xs"
          color="neutral"
          variant="ghost"
          aria-label="Close sensitive details"
          @click="findings = null"
        />
      </div>
      <p
        v-if="!findings.length"
        class="text-sm text-(--ui-text-muted)"
      >
        No sensitive details left to review.
      </p>
      <ul class="divide-y divide-(--ui-border)">
        <li
          v-for="(f, i) in findings"
          :key="`${f.text}-${i}`"
          class="py-2 first:pt-0 last:pb-0 space-y-1.5"
        >
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <UBadge
              size="sm"
              variant="subtle"
              color="warning"
              :label="SENSITIVE_KIND_LABELS[f.kind]"
            />
            <span class="font-medium line-through decoration-(--ui-error)">{{ f.text }}</span>
            <UIcon
              name="i-lucide-arrow-right"
              class="size-4 text-(--ui-text-dimmed)"
            />
            <UInput
              v-model="f.replacement"
              size="sm"
              class="min-w-48 flex-1"
              :aria-label="`Replacement for ${f.text}`"
            />
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <p class="text-xs text-(--ui-text-muted) flex-1">
              {{ f.reason }}
            </p>
            <UButton
              size="xs"
              icon="i-lucide-check"
              label="Replace"
              @click="acceptFinding(f)"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              label="Keep"
              @click="dismissFinding(f)"
            />
          </div>
        </li>
      </ul>
    </div>

    <div
      v-if="review"
      class="rounded-md border border-(--ui-border) p-3 space-y-3"
    >
      <div class="flex items-center justify-between gap-2">
        <h4 class="text-sm font-semibold">
          Review
        </h4>
        <UButton
          icon="i-lucide-x"
          size="xs"
          color="neutral"
          variant="ghost"
          aria-label="Close review"
          @click="review = null"
        />
      </div>
      <p class="text-sm">
        {{ review.summary }}
      </p>
      <ul class="space-y-1">
        <li
          v-for="key in REVIEW_CHECKS"
          :key="key"
          class="flex items-start gap-2 text-sm"
        >
          <UIcon
            :name="VERDICT_UI[review.checks[key].verdict].icon"
            class="size-4 mt-0.5 shrink-0"
            :class="VERDICT_UI[review.checks[key].verdict].class"
            :aria-label="VERDICT_UI[review.checks[key].verdict].label"
          />
          <span><span class="font-medium">{{ REVIEW_CHECK_LABELS[key] }}.</span> <span class="text-(--ui-text-muted)">{{ review.checks[key].note }}</span></span>
        </li>
      </ul>
      <template v-if="review.edits.length">
        <h5 class="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
          Suggested edits
        </h5>
        <ul class="divide-y divide-(--ui-border)">
          <li
            v-for="(e, i) in review.edits"
            :key="i"
            class="py-2 first:pt-0 last:pb-0 space-y-1"
          >
            <p
              v-if="e.find"
              class="text-sm line-through decoration-(--ui-error) text-(--ui-text-muted)"
            >
              {{ e.find }}
            </p>
            <p class="text-sm">
              <UBadge
                v-if="!e.find"
                size="sm"
                variant="subtle"
                label="Add"
                class="me-1"
              />{{ e.replace }}
            </p>
            <div class="flex flex-wrap items-center gap-2">
              <p class="text-xs text-(--ui-text-muted) flex-1">
                {{ e.reason }}
              </p>
              <UButton
                size="xs"
                icon="i-lucide-check"
                label="Accept"
                @click="acceptEdit(e)"
              />
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                label="Dismiss"
                @click="dismissEdit(e)"
              />
            </div>
          </li>
        </ul>
      </template>
      <template v-if="review.passages.length">
        <h5 class="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
          Scripture to consider
        </h5>
        <ul class="divide-y divide-(--ui-border)">
          <li
            v-for="p in review.passages"
            :key="p.reference"
            class="py-2 first:pt-0 last:pb-0 flex flex-wrap items-center gap-2"
          >
            <p class="text-sm flex-1">
              <span class="font-medium">{{ p.reference }}</span> <span class="text-(--ui-text-muted)">{{ p.why }}</span>
            </p>
            <UButton
              size="xs"
              icon="i-lucide-book-open-text"
              label="Insert"
              :loading="inserting === p.reference"
              @click="insertPassage(p)"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              label="Dismiss"
              @click="dismissPassage(p)"
            />
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>
