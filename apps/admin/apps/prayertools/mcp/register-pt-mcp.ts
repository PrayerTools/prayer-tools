// Registers the prayer.tools MCP tools with the MCP-layer registry. Added by
// modules/pt-mcp.ts only when the MCP layer is loaded.
//
// Re-registers the prayer.tools permissions first: the registry only accepts
// scopes already in the permission registry, and plugin order doesn't
// guarantee register-pt.ts ran before this.
import { getRegistry, type McpToolDef } from '#mcp-layer'
import { registerPermissions } from '#core/server/utils/permissions-registry'
import { PT_PERMISSIONS, PT_PERMISSION_META } from '../app/utils/pt-permissions'
import { siteTools } from './site-tools'
import { campaignTools } from './campaign-tools'
import { contentTools } from './content-tools'

export default defineNitroPlugin(() => {
  registerPermissions(PT_PERMISSIONS, PT_PERMISSION_META)

  const registry = getRegistry()
  for (const tool of [...siteTools, ...campaignTools, ...contentTools]) {
    registry.register(tool as McpToolDef<unknown, unknown>)
  }
})
