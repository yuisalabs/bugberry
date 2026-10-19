import type { Config } from "../config"

/** Scopes an AI app can ask for; bugberry:write covers every MCP tool that changes something. */
export const MCP_SCOPES = ["openid", "profile", "offline_access", "bugberry:read", "bugberry:write"] as const

/** The MCP server's resource identifier: access tokens are issued for exactly this URL. */
export function mcpResource(config: Pick<Config, "appUrl">): string {
  return `${config.appUrl}/api/mcp`
}
