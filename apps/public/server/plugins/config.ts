import { platformConfig } from '@prayertools/shared/config'

// Fails at startup when required configuration is missing.
export default defineNitroPlugin(() => {
  platformConfig()
})
