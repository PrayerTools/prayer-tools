<script setup lang="ts">
// A campaign's answers, edited the same way wherever a campaign is created or
// changed: the template (`withTemplate`), name, setup answers, place, its
// wording in each language (`withPlaceWording`), people group and timezone.
// The draft comes from usePtCampaignDraft; choosing a template emits `choose`
// for its chooseTemplate.
import type { PtCampaignDraft } from '../composables/usePtCampaignDraft'

withDefaults(defineProps<{
  withTemplate?: boolean
  withPlaceWording?: boolean
  withCadence?: boolean
  withLength?: boolean
  lockTemplate?: boolean
  dated?: boolean
  languages?: string[]
  disabled?: boolean
}>(), { withTemplate: false, withPlaceWording: false, withCadence: true, withLength: true, lockTemplate: false, dated: false, languages: () => [], disabled: false })
const draft = defineModel<PtCampaignDraft>({ required: true })
const emit = defineEmits<{ choose: [key: string] }>()
</script>

<template>
  <fieldset
    :disabled="disabled"
    class="divide-y divide-(--ui-border-accented)"
  >
    <PtTemplateChoice
      v-if="withTemplate"
      v-model="draft.templateKey"
      :timezone="draft.timezone"
      class="py-6 first:pt-0"
      @choose="(k: string) => emit('choose', k)"
    />
    <UFormField
      :ui="{ label: 'text-base font-semibold' }"
      class="py-6 first:pt-0"
      required
    >
      <template #label>
        Campaign name <InfoTip text="Shown on the site and in emails, e.g. “Ramadan 2027”." />
      </template>
      <UInput
        v-model="draft.name"
        class="w-full"
      />
    </UFormField>
    <slot name="after-name" />
    <PtSetupForm
      v-model="draft.setup"
      :template-key="draft.templateKey"
      :lock-template="lockTemplate"
      :with-cadence="withCadence"
      :with-length="withLength"
      :dated="dated"
      class="py-6"
    />
    <UFormField
      :ui="{ label: 'text-base font-semibold' }"
      class="py-6"
    >
      <template #label>
        Location (optional) <InfoTip text="Where the people you pray for are. Its name fills {place} in prayer content." />
      </template>
      <PtLocationSearch v-model="draft.location" />
    </UFormField>
    <UFormField
      v-if="withPlaceWording && draft.location"
      :ui="{ label: 'text-base font-semibold' }"
      class="py-6"
    >
      <template #label>
        How your place is written <InfoTip text="Its name in each language, and how to say “in” and “of” it. Prayer guides use these to name your place." />
      </template>
      <PtPlaceWording
        v-model="draft.placeWording"
        :place-name="draft.location.name"
        :languages="languages"
        :disabled="disabled"
      />
    </UFormField>
    <UFormField
      :ui="{ label: 'text-base font-semibold' }"
      class="py-6"
    >
      <template #label>
        People group (optional) <InfoTip text="Fills {people_group} in prayer content." />
      </template>
      <UInput
        v-model="draft.peopleGroup"
        placeholder="e.g. the Kurds of eastern Turkey"
        class="w-full"
      />
    </UFormField>
    <UFormField
      :ui="{ label: 'text-base font-semibold' }"
      class="py-6 last:pb-0"
    >
      <template #label>
        Timezone <InfoTip text="Campaign days begin at midnight in this timezone." />
      </template>
      <USelectMenu
        v-model="draft.timezone"
        :items="ptTimezones()"
        class="w-full sm:w-80"
      />
    </UFormField>
  </fieldset>
</template>
