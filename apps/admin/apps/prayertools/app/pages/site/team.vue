<script setup lang="ts">
// The site's team: owners, editors, translators and viewers. Invites and
// memberships use the tenancy layer's endpoints; a site always keeps an owner.
definePageMeta({ middleware: 'auth' })

interface Member { membership_id: string, user_id: string, email: string, display_name: string, roles: string[], status: string, joined_at: string }

const { data: site, can, slug } = usePtSite()
const { user } = useAuth()
const toast = usePtToast()
const { data, refresh, pending, error } = useFetch<{ rows: Member[] }>(() => `/api/o/${slug.value}/members`, { key: computed(() => `pt-team-${slug.value}`) })

const ROLE_ITEMS = PT_ROLE_KEYS.map(value => ({ value, label: PT_LABELS.role[value], description: PT_LABELS.roleDescription[value] }))
const invite = reactive({ email: '', display_name: '', role: 'pt-editor' })
const inviting = ref(false)
const inviteOpen = ref(false)

const STATUS_META: Record<string, { label: string, color: 'success' | 'warning' | 'info' | 'error', icon: string }> = {
  active: { label: 'Active', color: 'success', icon: 'i-lucide-badge-check' },
  not_verified: { label: 'Not verified', color: 'warning', icon: 'i-lucide-mail-warning' },
  pending_invite: { label: 'Invitation sent', color: 'info', icon: 'i-lucide-mail' },
  expired_invite: { label: 'Invitation expired', color: 'error', icon: 'i-lucide-mail-x' }
}

function initials(m: Member): string {
  const parts = (m.display_name || m.email || '?').trim().split(/\s+/).filter(Boolean)
  return (parts.length >= 2 ? parts[0]![0]! + parts[parts.length - 1]![0]! : (parts[0] ?? '?').slice(0, 2)).toUpperCase()
}

function roleOf(m: Member): string {
  return PT_ROLE_KEYS.find(r => m.roles.includes(r)) ?? m.roles[0] ?? 'member'
}

async function sendInvite() {
  inviting.value = true
  try {
    const res = await $fetch<{ status: string }>(`/api/o/${slug.value}/invite`, { method: 'POST', body: { email: invite.email, display_name: invite.display_name || invite.email.split('@')[0], roles: [invite.role] } })
    toast.ok(res.status === 'pending' ? 'Invitation sent' : 'Added to the team')
    invite.email = ''
    invite.display_name = ''
    inviteOpen.value = false
    await refresh()
  } catch (err) {
    toast.fail(err, 'Could not invite')
  } finally {
    inviting.value = false
  }
}
async function setRole(m: Member, role: string) {
  try {
    await $fetch(`/api/o/${slug.value}/members/${m.user_id}/roles`, { method: 'PATCH', body: { roles: [role] } })
    await refresh()
    toast.ok('Role changed')
  } catch (err) {
    toast.fail(err)
    await refresh()
  }
}
const removing = ref<Member | null>(null)
const removeOpen = computed({
  get: () => !!removing.value,
  set: (v: boolean) => {
    if (!v) removing.value = null
  }
})
async function remove(m: Member) {
  removing.value = null
  try {
    await $fetch(`/api/o/${slug.value}/members/${m.user_id}`, { method: 'DELETE' })
    if (m.user_id === user.value?.id) return navigateTo('/orgs')
    await refresh()
  } catch (err) {
    toast.fail(err)
  }
}
</script>

<template>
  <div class="max-w-6xl mx-auto space-y-8">
    <div class="flex flex-wrap items-start justify-between gap-6 rounded-lg bg-[#202833] p-6 sm:p-8 text-white">
      <div>
        <p class="mb-3 text-xs font-semibold uppercase tracking-widest text-orange-300">Working together</p>
        <h1 class="text-2xl font-bold">
          Team
        </h1>
        <p class="mt-3 max-w-xl text-sm leading-relaxed text-slate-200">
          Invite people to help manage your campaign, write prayers, or translate content. Access applies to this site only.
        </p>
      </div>
      <UButton
        v-if="can('org.members.invite')"
        icon="i-lucide-user-plus"
        label="Invite team member"
        size="lg"
        @click="inviteOpen = true"
      />
    </div>

    <UAlert v-if="error" color="error" title="Team members could not be loaded" :description="ptErrorMessage(error)" :actions="[{ label: 'Try again', onClick: () => refresh() }]" />
    <div v-else-if="pending && !data" class="space-y-3" role="status" aria-label="Loading team members">
      <USkeleton v-for="n in 3" :key="n" class="h-24 rounded-lg" />
    </div>

    <div v-else class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <template #header>
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-lg font-semibold">Team members</h2>
          <UBadge color="neutral" variant="soft" :label="String(data?.rows.length ?? 0)" />
        </div>
      </template>
      <ul class="divide-y divide-(--ui-border)">
        <li
          v-for="m in data?.rows ?? []"
          :key="m.membership_id"
          class="px-4 sm:px-6 py-5 flex flex-wrap items-center gap-4"
        >
          <div class="shrink-0 size-11 rounded-full bg-[#fff0e3] text-[#a94300] flex items-center justify-center text-sm font-semibold">
            {{ initials(m) }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-medium truncate">
                {{ m.display_name }}
              </p>
              <UBadge
                v-if="m.user_id === user?.id"
                label="You"
                color="neutral"
                variant="subtle"
                size="sm"
              />
              <UBadge
                v-if="STATUS_META[m.status]"
                :color="STATUS_META[m.status]!.color"
                :icon="STATUS_META[m.status]!.icon"
                :label="STATUS_META[m.status]!.label"
                variant="subtle"
                size="sm"
              />
            </div>
            <a
              :href="`mailto:${m.email}`"
              class="text-sm text-(--ui-text-muted) hover:text-(--ui-text) inline-flex items-center gap-1.5 max-w-full"
            >
              <UIcon
                name="i-lucide-mail"
                class="size-3.5 shrink-0"
              />
              <span class="truncate">{{ m.email }}</span>
            </a>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <USelect
              :model-value="roleOf(m)"
              :items="ROLE_ITEMS.map(r => ({ value: r.value, label: r.label }))"
              :disabled="!can('org.members.manage_roles')"
              class="w-36"
              size="lg"
              :aria-label="`Role of ${m.display_name}`"
              @update:model-value="(v) => setRole(m, v as string)"
            />
            <UButton
              v-if="can('org.members.remove') || m.user_id === user?.id"
              size="sm"
              color="error"
              variant="ghost"
              :icon="m.user_id === user?.id ? 'i-lucide-log-out' : 'i-lucide-user-minus'"
              :label="m.user_id === user?.id ? 'Leave' : 'Remove'"
              @click="removing = m"
            />
          </div>
        </li>
      </ul>
      <UEmpty
        v-if="!data?.rows.length"
        icon="i-lucide-users"
        title="No team members yet"
      />
    </UCard>

    <UCard>
      <template #header><h2 class="text-lg font-semibold">What each role can do</h2></template>
      <dl class="space-y-5">
        <div v-for="role in ROLE_ITEMS" :key="role.value">
          <dt class="font-semibold text-sm">{{ role.label }}</dt>
          <dd class="mt-1 text-sm leading-relaxed text-(--ui-text-muted)">{{ role.description }}</dd>
        </div>
      </dl>
    </UCard>
    </div>

    <UAlert
      v-if="site"
      color="neutral"
      variant="subtle"
      icon="i-lucide-shield"
      description="A site can have several owners; the last owner can't leave or be demoted. If an owner leaves, Prayer.Tools can make another member an owner."
    />

    <UModal
      v-model:open="inviteOpen"
      :dismissible="!inviting"
      :ui="{ content: 'max-w-xl' }"
    >
      <template #content>
        <form
          class="p-6 space-y-5"
          @submit.prevent="sendInvite"
        >
          <div class="flex items-start gap-3">
            <div class="shrink-0 size-10 rounded-full bg-(--ui-primary)/10 flex items-center justify-center">
              <UIcon
                name="i-lucide-user-plus"
                class="size-5 text-(--ui-primary)"
              />
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="text-lg font-semibold">
                Invite team member
              </h3>
              <p class="text-sm text-(--ui-text-muted) mt-1">
                Someone who already has an account is added right away. Anyone else gets an email invitation.
              </p>
            </div>
          </div>
          <div class="grid sm:grid-cols-2 gap-3">
            <UFormField
              label="Email"
              required
            >
              <UInput
                v-model="invite.email"
                type="email"
                placeholder="name@example.com"
                autocomplete="off"
                class="w-full"
                size="lg"
              />
            </UFormField>
            <UFormField label="Name">
              <UInput
                v-model="invite.display_name"
                size="lg"
                autocomplete="off"
                class="w-full"
              />
            </UFormField>
          </div>
          <UFormField label="Role">
            <URadioGroup
              v-model="invite.role"
              :items="ROLE_ITEMS"
              variant="card"
            />
          </UFormField>
          <div class="flex items-center justify-end gap-3 pt-2">
            <UButton
              type="button"
              variant="ghost"
              color="neutral"
              label="Cancel"
              :disabled="inviting"
              @click="inviteOpen = false"
            />
            <UButton
              type="submit"
              icon="i-lucide-send"
              label="Send invite"
              size="lg"
              :loading="inviting"
              :disabled="!invite.email.includes('@')"
            />
          </div>
        </form>
      </template>
    </UModal>

    <UModal v-model:open="removeOpen">
      <template #content>
        <div class="p-6 space-y-5">
          <div class="flex items-start gap-3">
            <div class="shrink-0 size-10 rounded-full bg-(--ui-error)/10 flex items-center justify-center">
              <UIcon
                name="i-lucide-triangle-alert"
                class="size-5 text-(--ui-error)"
              />
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="text-lg font-semibold">
                {{ removing?.user_id === user?.id ? 'Leave this site?' : 'Remove from the team?' }}
              </h3>
              <p class="text-sm text-(--ui-text-muted) mt-1">
                <template v-if="removing?.user_id === user?.id">
                  You lose access to this site. An owner can invite you again later.
                </template>
                <template v-else>
                  <span class="font-medium text-(--ui-text)">{{ removing?.display_name }}</span> ({{ removing?.email }}) loses access to this site. Their account is not affected and they can be invited again later.
                </template>
              </p>
            </div>
          </div>
          <div class="flex items-center justify-end gap-3 pt-2">
            <UButton
              variant="ghost"
              color="neutral"
              label="Cancel"
              @click="removing = null"
            />
            <UButton
              color="error"
              :icon="removing?.user_id === user?.id ? 'i-lucide-log-out' : 'i-lucide-user-minus'"
              :label="removing?.user_id === user?.id ? 'Leave' : 'Remove'"
              @click="removing && remove(removing)"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
