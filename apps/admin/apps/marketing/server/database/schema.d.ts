// Adds the marketing tables to the host schema through core's global
// `NuxtinatorDatabaseTables` registry. Each table is listed by name: an
// `extends` clause doesn't merge into the global interface.
import type { MarketingTables } from '../../lib/types'

declare global {
  interface NuxtinatorDatabaseTables {
    marketing_email: MarketingTables['marketing_email']
    marketing_delivery: MarketingTables['marketing_delivery']
    marketing_parent: MarketingTables['marketing_parent']
    marketing_parent_recipient: MarketingTables['marketing_parent_recipient']
    marketing_template: MarketingTables['marketing_template']
    marketing_template_shares: MarketingTables['marketing_template_shares']
  }
}
