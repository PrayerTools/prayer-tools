import { addServerPlugin, defineNuxtModule } from '@nuxt/kit'
import { fileURLToPath } from 'node:url'

// Registers the prayer.tools MCP tools when the MCP layer is loaded. They live
// outside `server/` so a build without MCP never compiles their `#mcp-layer`
// import; with MCP they join the server tsconfig.
export default defineNuxtModule({
  meta: { name: 'prayertools/mcp' },
  setup(_, nuxt) {
    if (!nuxt.options.alias['#mcp-layer']) return
    const mcpDir = fileURLToPath(new URL('../mcp', import.meta.url))
    addServerPlugin(`${mcpDir}/register-pt-mcp.ts`)
    nuxt.hook('nitro:config', (config) => {
      config.typescript ??= {}
      config.typescript.tsConfig ??= {}
      config.typescript.tsConfig.include = [...(config.typescript.tsConfig.include ?? []), `${mcpDir}/**/*`]
    })
  }
})
