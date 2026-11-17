// "Ask Prayer.Tools for help" in an inbox conversation's More actions menu,
// for team members who can reply in the inbox. The route enforces the same.
import { registerInboxThreadAction } from '#inbox'
import PtHelpRequestModal from '../components/PtHelpRequestModal.vue'

export default defineNuxtPlugin(() => {
  const overlay = useOverlay()
  // Core's permission store for the active org, which the inbox page loads.
  const { data: perms } = useNuxtData<{ perms: string[] }>('user-perms')
  registerInboxThreadAction({
    id: 'pt-ask-for-help',
    label: 'Ask Prayer.Tools for help',
    icon: 'i-lucide-life-buoy',
    visible: () => !!perms.value?.perms.includes('inbox.send'),
    onSelect: async (ctx) => {
      const sent = await overlay.create(PtHelpRequestModal, { destroyOnClose: true }).open({ conversationId: ctx.conversation.id })
      if (sent === true) await ctx.refresh()
    }
  })
})
