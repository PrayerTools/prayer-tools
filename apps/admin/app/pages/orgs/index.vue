<script setup lang="ts">
// Your sites: every site you belong to. With none, onboarding starts here.
definePageMeta({ middleware: 'auth' })

interface SiteRow {
  id: string
  slug: string
  name: string
  roles: string[]
  status: 'draft' | 'published' | 'archived'
  suspended: boolean
  url: string
  onboarding: { step?: string, completed?: boolean }
  campaign: { id: string, name: string, state: string, start_date: string | null, type: string, goal: string } | null
  people: number
}

interface InviteRow {
  id: string
  invited_by: string | null
  sites: { name: string, slug: string, roles: string[] }[]
}

const { data, status, refresh } = await useFetch<{ sites: SiteRow[], invites: InviteRow[] }>('/api/pt/sites', { key: 'pt-my-sites' })
const { user } = useAuth()
const isOperator = computed(() => !!(user.value as { is_admin?: boolean } | null)?.is_admin)
const q = ref('')
const sites = computed(() => (data.value?.sites ?? []).filter(s => !q.value || `${s.name} ${s.slug}`.toLowerCase().includes(q.value.toLowerCase())))
const toast = usePtToast()
const accepting = ref<string | null>(null)
const declining = ref<string | null>(null)

async function decline(invite: InviteRow) {
  declining.value = invite.id
  try {
    await $fetch(`/api/pt/invites/${invite.id}/decline`, { method: 'POST' })
    await refresh()
  } catch (err) {
    toast.fail(err, 'Could not decline the invitation')
  } finally {
    declining.value = null
  }
}

async function accept(invite: InviteRow) {
  accepting.value = invite.id
  try {
    const res = await $fetch<{ slug: string | null }>(`/api/pt/invites/${invite.id}/accept`, { method: 'POST' })
    await refreshNuxtData('user-orgs').catch(() => {})
    if (res.slug) await navigateTo(`/@${res.slug}/site`)
    else await refresh()
  } catch (err) {
    toast.fail(err, 'Could not accept the invitation')
  } finally {
    accepting.value = null
  }
}

function roleLabel(roles: string[]): string {
  return roles.map(r => PT_LABELS.role[r] ?? r).join(', ')
}
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">
          Your sites
        </h1>
        <p class="text-sm text-(--ui-text-muted)">
          Every prayer campaign site you work on, in one place.
        </p>
      </div>
      <div class="flex gap-2">
        <UButton
          to="/libraries"
          icon="i-lucide-library"
          color="neutral"
          variant="outline"
          label="Libraries"
        />
        <UButton
          to="/personal"
          icon="i-lucide-images"
          color="neutral"
          variant="outline"
          label="My images & blocks"
        />
        <UButton
          to="/orgs/new"
          icon="i-lucide-plus"
          label="New site"
        />
      </div>
    </div>

    <UAlert
      v-for="inv in data?.invites ?? []"
      :key="`invite-${inv.id}`"
      icon="i-lucide-mail-plus"
      color="info"
      variant="soft"
      :title="`You're invited to ${inv.sites.map(x => x.name).join(', ')}`"
      :description="`${inv.invited_by ? `From ${inv.invited_by}. ` : ''}Your role: ${roleLabel(inv.sites[0]?.roles ?? [])}.`"
      :actions="[
        { label: 'Accept', loading: accepting === inv.id, onClick: () => accept(inv) },
        { label: 'Decline', color: 'neutral', variant: 'outline', loading: declining === inv.id, onClick: () => decline(inv) }
      ]"
    />

    <div
      v-if="status === 'pending'"
      class="text-sm text-(--ui-text-muted)"
    >
      Loading…
    </div>

    <UCard
      v-else-if="!data?.sites.length"
      :ui="{ body: 'p-8 text-center space-y-4' }"
    >
      <UIcon
        name="i-lucide-sprout"
        class="size-12 text-(--ui-primary) mx-auto"
      />
      <h2 class="text-xl font-semibold">
        Start your first prayer campaign
      </h2>
      <p class="text-(--ui-text-muted) max-w-lg mx-auto">
        A site is the home of your prayer effort: its address, team, look and the people who pray.
        Each time you run it — Ramadan 2026, Ramadan 2027 — is a campaign on that site.
      </p>
      <UButton
        to="/orgs/new"
        size="lg"
        label="Create a site"
        icon="i-lucide-arrow-right"
        trailing
      />
    </UCard>

    <template v-else>
      <UInput
        v-if="(data?.sites.length ?? 0) > 6"
        v-model="q"
        icon="i-lucide-search"
        placeholder="Search your sites"
        class="w-full sm:w-80"
      />
      <div class="grid sm:grid-cols-2 gap-4">
        <UCard
          v-for="s in sites"
          :key="s.id"
          :ui="{ body: 'space-y-3' }"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <NuxtLink
                :to="`/@${s.slug}/site`"
                class="text-lg font-semibold hover:underline"
              >
                {{ s.name }}
              </NuxtLink>
              <p class="text-xs text-(--ui-text-muted) truncate">
                <a
                  :href="s.url"
                  target="_blank"
                  rel="noopener"
                  class="hover:underline"
                >{{ s.url.replace(/^https?:\/\//, '') }}</a>
              </p>
            </div>
            <UBadge
              :label="s.suspended ? 'Suspended' : PT_LABELS.siteStatus[s.status]"
              :color="s.suspended ? 'error' : ptStatusColor(s.status)"
              variant="subtle"
            />
          </div>
          <div class="text-sm space-y-1">
            <p v-if="s.campaign">
              <span class="font-medium">{{ s.campaign.name }}</span>
              <span class="text-(--ui-text-muted)"> · {{ PT_LABELS.campaignState[s.campaign.state] }}</span>
            </p>
            <p
              v-else
              class="text-(--ui-text-muted)"
            >
              No campaign yet
            </p>
            <p
              v-if="s.campaign"
              class="flex flex-wrap items-center gap-x-4 gap-y-1 text-(--ui-text-muted)"
            >
              <span class="inline-flex items-center gap-1.5">
                <UIcon
                  :name="PT_CAMPAIGN_TYPE_ICONS[s.campaign.type] ?? 'i-lucide-calendar'"
                  class="size-4 shrink-0"
                />
                <span class="sr-only">Type:</span>
                {{ PT_LABELS.campaignType[s.campaign.type] }}
              </span>
              <span class="inline-flex items-center gap-1.5">
                <UIcon
                  :name="PT_GOAL_ICONS[s.campaign.goal] ?? 'i-lucide-target'"
                  class="size-4 shrink-0"
                />
                <span class="sr-only">Goal:</span>
                {{ PT_LABELS.goal[s.campaign.goal] }}
              </span>
            </p>
            <p class="text-(--ui-text-muted)">
              {{ s.people.toLocaleString() }} people · {{ roleLabel(s.roles) }}
            </p>
          </div>
          <div class="flex gap-2">
            <UButton
              v-if="!s.onboarding?.completed && s.status === 'draft'"
              :to="`/@${s.slug}/site/setup`"
              size="sm"
              label="Continue setup"
              icon="i-lucide-list-checks"
            />
            <UButton
              :to="`/@${s.slug}/site`"
              size="sm"
              color="neutral"
              variant="outline"
              label="Open"
            />
          </div>
        </UCard>
      </div>
    </template>

    <p
      v-if="isOperator"
      class="text-sm text-(--ui-text-muted)"
    >
      Operators can search every site in <NuxtLink
        to="/admin/pt/sites"
        class="underline"
      >Admin → Sites</NuxtLink>.
    </p>
  </div>
</template>
