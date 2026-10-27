<script setup lang="ts">
// Custom domains: add a domain, see the DNS records to create and the
// verification status, check now, remove. The {slug} address always keeps working.
import type { PtSiteResponse } from '../../../composables/usePtSite'

definePageMeta({ middleware: 'auth' })

type Domain = PtSiteResponse['domains'][number]

const { data: site, refresh, can } = usePtSite()
const { data: meta } = usePtMeta()
const toast = usePtToast()
const rawToast = useToast()
const hostname = ref('')
const adding = ref(false)
const busy = ref<string | null>(null)
const addRow = useSettingsRow('pt-add-domain')

async function add() {
  adding.value = true
  try {
    await $fetch('/api/pt/domains', { method: 'POST', body: { hostname: hostname.value } })
    hostname.value = ''
    addRow.close()
    toast.ok('Domain added', 'Now add the DNS records below at your domain provider.')
    await refresh()
  } catch (err) {
    toast.fail(err, 'Could not add the domain')
  } finally {
    adding.value = false
  }
}
async function check(d: Domain) {
  busy.value = d.id
  try {
    const res = await $fetch<{ domain: { status: string } }>(`/api/pt/domains/${d.id}/check`, { method: 'POST' })
    const active = res.domain.status === 'active'
    rawToast.add({
      title: active ? `${d.hostname} is active` : `${d.hostname} isn't ready yet`,
      description: active ? 'It is now your site\'s main address.' : 'DNS changes can take a few minutes to a few hours.',
      color: active ? 'success' : 'info'
    })
    await refresh()
  } catch (err) {
    toast.fail(err, 'Could not check the domain')
  } finally {
    busy.value = null
  }
}

const removeTarget = ref<Domain | null>(null)
const removeOpen = computed({
  get: () => !!removeTarget.value,
  set: (v) => { if (!v) removeTarget.value = null }
})
async function remove() {
  const d = removeTarget.value
  if (!d) return
  busy.value = d.id
  try {
    await $fetch(`/api/pt/domains/${d.id}`, { method: 'DELETE' })
    toast.ok(`${d.hostname} removed`)
    removeTarget.value = null
    await refresh()
  } catch (err) {
    toast.fail(err, 'Could not remove the domain')
  } finally {
    busy.value = null
  }
}

function records(d: Domain): { type: string, name: string, value: string }[] {
  return d.verification?.records?.length ? d.verification.records : [{ type: 'CNAME', name: d.hostname, value: meta.value?.fallbackOrigin ?? '' }]
}
async function copy(text: string) {
  await navigator.clipboard.writeText(text)
  toast.ok('Copied')
}
</script>

<template>
  <div
    v-if="site"
    class="max-w-3xl mx-auto space-y-6"
  >
    <PtSettingsTabs />
    <h1 class="text-2xl font-bold">
      Domains
      <InfoTip>
        <p>
          Your site always works at its prayer.tools address. You can also use a domain you own, like
          <span class="font-mono">pray.yourchurch.org</span>.
        </p>
        <p>Once it's active it becomes the main address and the prayer.tools address redirects to it.</p>
      </InfoTip>
    </h1>

    <UAlert
      v-if="!can('pt.site.manage')"
      color="neutral"
      variant="subtle"
      icon="i-lucide-lock"
      title="Only site owners can manage domains."
    />

    <SettingsGroup
      v-else
      title="Addresses"
    >
      <SettingsRow
        label="Prayer.Tools address"
        :value="site.subdomainUrl.replace(/^https?:\/\//, '')"
      />

      <SettingsRow
        v-for="d in site.domains"
        :key="d.id"
        :label="d.hostname"
      >
        <span class="inline-flex items-center gap-2">
          <UBadge
            :label="PT_LABELS.domainStatus[d.status] ?? d.status"
            :color="ptStatusColor(d.status)"
            variant="subtle"
            size="sm"
          />
          <template v-if="d.activated_at">Active since {{ ptFormatDate(d.activated_at) }}.</template>
          <template v-if="d.last_checked_at">Last checked {{ ptFormatDate(d.last_checked_at, { dateStyle: 'medium', timeStyle: 'short' }) }}.</template>
        </span>
        <template #actions>
          <UButton
            variant="outline"
            color="neutral"
            icon="i-lucide-refresh-cw"
            label="Check now"
            :loading="busy === d.id"
            @click="check(d)"
          />
          <UButton
            variant="outline"
            color="error"
            label="Remove"
            @click="removeTarget = d"
          />
        </template>
        <template
          v-if="d.status !== 'active'"
          #footer
        >
          <div class="space-y-3 text-sm">
            <UAlert
              v-if="d.status === 'failing'"
              color="error"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              title="This domain no longer points to Prayer.Tools"
            />
            <p>
              At your domain provider, add {{ records(d).length > 1 ? 'these DNS records' : 'this DNS record' }}
              <InfoTip>
                <p>The TXT records, when shown, prove you own the domain and let us issue its certificate.</p>
                <p>Changes can take from a few minutes to a few hours; then press “Check now”. We also check every day and email you if a domain stops pointing to us.</p>
                <p v-if="d.status === 'failing'">
                  Until it's fixed, emails and share links use your prayer.tools address.
                </p>
              </InfoTip>
            </p>
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <thead class="text-xs text-(--ui-text-muted)">
                  <tr>
                    <th class="py-1 pe-4">
                      Type
                    </th>
                    <th class="py-1 pe-4">
                      Name
                    </th>
                    <th class="py-1">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody class="font-mono">
                  <tr
                    v-for="(r, i) in records(d)"
                    :key="i"
                  >
                    <td class="py-1 pe-4 align-top">
                      {{ r.type }}
                    </td>
                    <td class="py-1 pe-4 break-all align-top">
                      {{ r.name }}
                    </td>
                    <td class="py-1 break-all">
                      <span class="me-1">{{ r.value }}</span>
                      <UButton
                        size="xs"
                        variant="ghost"
                        color="neutral"
                        icon="i-lucide-copy"
                        aria-label="Copy value"
                        @click="copy(r.value)"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </SettingsRow>

      <SettingsRow
        label="Your own domain"
        :value="site.domains.length ? undefined : 'None yet'"
        :open="addRow.open.value"
      >
        <template
          v-if="!addRow.open.value"
          #actions
        >
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-plus"
            label="Add domain"
            @click="addRow.toggle"
          />
        </template>
        <template #panel>
          <form
            class="space-y-4 max-w-md"
            @submit.prevent="add"
          >
            <UFormField>
              <template #label>
                Domain <InfoTip text="Use a subdomain such as pray.yourchurch.org. A site can have up to three." />
              </template>
              <UInput
                v-model="hostname"
                placeholder="pray.example.org"
                autofocus
                class="w-full font-mono"
              />
            </UFormField>
            <div class="flex gap-2">
              <UButton
                type="submit"
                label="Add domain"
                :loading="adding"
                :disabled="!hostname.trim()"
              />
              <UButton
                color="neutral"
                variant="ghost"
                label="Cancel"
                :disabled="adding"
                @click="addRow.close"
              />
            </div>
          </form>
        </template>
      </SettingsRow>
    </SettingsGroup>

    <ConfirmModal
      v-model:open="removeOpen"
      :title="`Remove ${removeTarget?.hostname}?`"
      description="The domain stops serving your site right away. Your prayer.tools address keeps working."
      confirm-label="Remove domain"
      :loading="!!removeTarget && busy === removeTarget.id"
      @confirm="remove"
    />
  </div>
</template>
