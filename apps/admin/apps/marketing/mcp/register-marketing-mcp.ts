// Registers the site email MCP tools with the MCP-layer registry. Added by
// modules/marketing-mcp.ts only when the MCP layer is loaded.
//
// Re-registers the marketing permissions first: the registry only accepts
// scopes already in the permission registry, and plugin order doesn't
// guarantee register-marketing.ts ran before this.
import { getRegistry, type McpToolDef } from '#mcp-layer'
import { registerPermissions } from '#core/server/utils/permissions-registry'
import { MARKETING_PERMISSIONS, MARKETING_PERMISSION_META } from '../app/utils/marketing-permissions'
import { marketingMcpTools } from './marketing-tools'

export default defineNitroPlugin(() => {
  registerPermissions(MARKETING_PERMISSIONS, MARKETING_PERMISSION_META)

  const registry = getRegistry()
  for (const tool of marketingMcpTools) {
    registry.register(tool as McpToolDef<unknown, unknown>)
  }
})
