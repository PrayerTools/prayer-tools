// Adds the prayer.tools panel to CRM contact pages.
import { registerRecordsDetailPanel } from '#records'
import PtSubscriptionPanel from '../components/PtSubscriptionPanel.vue'

export default defineNuxtPlugin(() => {
  registerRecordsDetailPanel({
    id: 'pt-subscription',
    recordTypes: ['contacts'],
    component: PtSubscriptionPanel,
    order: 10
  })
})
