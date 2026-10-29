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

async function add() {
  adding.value = true
  try {
    await $fetch('/api/pt/domains', { method: 'POST', body: { hostname: hostname.value } })
    hostname.value = ''
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
    class="max-w-6xl mx-auto space-y-6"
  >
    <PtSettingsTabs />
    <div class="rounded-lg bg-[#202833] p-6 sm:p-8 text-white">
      <p class="mb-3 text-xs font-semibold uppercase tracking-widest text-orange-300">Your campaign’s address</p>
      <h1 class="text-2xl font-bold">
        Domains
      </h1>
      <p class="mt-3 max-w-2xl text-sm leading-relaxed text-slate-200">
        Use your included address or connect a domain you own. Once a custom domain is active, it becomes your main address.
      </p>
    </div>

    <UCard>
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="space-y-2 min-w-0">
          <h2 class="text-lg font-semibold">Included site address</h2>
          <p class="font-mono text-sm break-all">{{ site.subdomainUrl.replace(/^https?:\/\//, '') }}</p>
          <p class="text-sm text-(--ui-text-muted)">This address stays available and redirects to your custom domain once it is active.</p>
        </div>
        <UButton label="Copy address" icon="i-lucide-copy" variant="outline" color="neutral" @click="copy(site.subdomainUrl)" />
      </div>
    </UCard>

    <UAlert
      v-if="!can('pt.site.manage')"
      color="neutral"
      variant="subtle"
      icon="i-lucide-lock"
      title="Only site owners can manage domains."
    />

    <template v-else>
      <UCard>
        <template #header><h2 class="text-lg font-semibold">Connect a custom domain</h2></template>
        <ol class="mb-6 grid gap-4 sm:grid-cols-3 text-sm">
          <li><p class="font-semibold">Add your domain</p><p class="mt-1 text-(--ui-text-muted)">Enter a subdomain you own, such as pray.yourchurch.org.</p></li>
          <li><p class="font-semibold">Update your DNS</p><p class="mt-1 text-(--ui-text-muted)">Copy the records we provide to your domain provider.</p></li>
          <li><p class="font-semibold">Check the connection</p><p class="mt-1 text-(--ui-text-muted)">Choose Check now after the records have updated.</p></li>
        </ol>
        <form
          class="space-y-3"
          @submit.prevent="add"
        >
          <div class="flex gap-3 flex-wrap">
            <UInput
              v-model="hostname"
              placeholder="pray.example.org"
              aria-label="Your domain"
              size="lg"
              class="flex-1 min-w-60 font-mono"
            />
            <UButton
              type="submit"
              icon="i-lucide-plus"
              label="Add domain"
              size="lg"
              :loading="adding"
              :disabled="!hostname.trim() || site.domains.length >= 3"
            />
          </div>
          <p class="text-xs text-muted">
            Use a subdomain such as pray.yourchurch.org. A site can have up to three.
          </p>
        </form>
      </UCard>

      <div class="flex items-center justify-between gap-3">
        <h2 class="text-xl font-semibold">Custom domains</h2>
        <UBadge color="neutral" variant="soft" :label="`${site.domains.length} of 3`" />
      </div>
      <UCard v-if="!site.domains.length">
        <div class="flex items-start gap-3">
          <UIcon name="i-lucide-globe" class="mt-1 size-5 text-(--ui-text-muted)" />
          <div><p class="font-semibold">No custom domains connected</p><p class="mt-1 text-sm text-(--ui-text-muted)">Your included address is ready to use. Connecting your own domain is optional.</p></div>
        </div>
      </UCard>

      <UCard
        v-for="d in site.domains"
        :key="d.id"
      >
        <div class="space-y-4">
          <div class="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono font-semibold break-all">{{ d.hostname }}</span>
                <UBadge
                  :label="PT_LABELS.domainStatus[d.status] ?? d.status"
                  :color="ptStatusColor(d.status)"
                  variant="subtle"
                />
              </div>
              <p class="text-xs text-muted mt-1">
                <template v-if="d.activated_at">
                  Active since {{ ptFormatDate(d.activated_at) }}.
                </template>
                <template v-if="d.last_checked_at">
                  Last checked {{ ptFormatDate(d.last_checked_at, { dateStyle: 'medium', timeStyle: 'short' }) }}.
                </template>
              </p>
            </div>
            <div class="flex gap-2">
              <UButton
                size="sm"
                variant="outline"
                color="neutral"
                icon="i-lucide-refresh-cw"
                label="Check now"
                :loading="busy === d.id"
                @click="check(d)"
              />
              <UButton
                size="sm"
                variant="ghost"
                color="error"
                icon="i-lucide-trash-2"
                aria-label="Remove domain"
                @click="removeTarget = d"
              />
            </div>
          </div>

          <UAlert
            v-if="d.status === 'failing'"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="This domain no longer points to Prayer.Tools"
            description="Emails and share links use your prayer.tools address until it's fixed. Check the DNS records below."
          />

          <div
            v-if="d.status !== 'active'"
            class="space-y-3 text-sm"
          >
            <p>At your domain provider, add {{ records(d).length > 1 ? 'these DNS records' : 'this DNS record' }}:</p>
            <div class="overflow-x-auto rounded-lg border border-(--ui-border) p-3 bg-(--ui-bg-muted)">
              <table class="w-full text-left text-sm">
                <thead class="text-xs text-muted">
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
            <p class="text-xs text-muted">
              The TXT records, when shown, prove you own the domain and let us issue its certificate. Changes can take
              from a few minutes to a few hours; then press “Check now”. We also check every day and email you if a
              domain stops pointing to us.
            </p>
          </div>
        </div>
      </UCard>
    </template>

    <UModal
      v-model:open="removeOpen"
      :title="`Remove ${removeTarget?.hostname}?`"
      description="The domain stops serving your site right away. Your prayer.tools address keeps working."
    >
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            label="Cancel"
            @click="removeTarget = null"
          />
          <UButton
            color="error"
            label="Remove domain"
            :loading="!!removeTarget && busy === removeTarget.id"
            @click="remove"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
