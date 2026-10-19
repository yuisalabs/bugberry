/**
 * Access tokens from Better Auth's mcp() plugin are EdDSA JWTs signed with the keys jwt() keeps in the
 * `jwks` table: sub = user id, client_id = the AI app, aud includes `${APP_URL}/api/mcp`, iss =
 * `${APP_URL}/api/auth`, scope = space-separated. They are verified here in-process against those keys
 * (no HTTP round trip to /api/auth/jwks), and the person's consent must still exist, so revoking an app
 * in the dashboard stops its tokens at once instead of when they expire.
 */
import { and, eq } from "drizzle-orm"
import { createLocalJWKSet, type JSONWebKeySet, jwtVerify } from "jose"
import type { AppDeps } from "../app"
import { mcpResource } from "../auth/mcp-oauth"
import { oauthClient, oauthConsent } from "../db/schema"
import type { McpScope } from "./context"

export interface VerifiedOAuthToken {
  userId: string
  clientId: string
  clientName: string
  scopes: McpScope[]
}

const MCP_SCOPE_SET = new Set<string>(["bugberry:read", "bugberry:write"])

export async function verifyOAuthAccessToken(
  deps: Pick<AppDeps, "betterAuth" | "db" | "config">,
  token: string,
): Promise<VerifiedOAuthToken | null> {
  try {
    const keys = (await deps.betterAuth.api.getJwks()) as JSONWebKeySet
    const { payload } = await jwtVerify(token, createLocalJWKSet(keys), {
      issuer: `${deps.config.appUrl}/api/auth`,
      audience: mcpResource(deps.config),
      currentDate: new Date(Date.now()),
    })
    const userId = typeof payload.sub === "string" ? payload.sub : null
    const clientId = typeof payload.client_id === "string" ? payload.client_id : typeof payload.azp === "string" ? payload.azp : null
    if (!userId || !clientId) return null

    const [consent] = await deps.db
      .select({ id: oauthConsent.id, clientName: oauthClient.name, disabled: oauthClient.disabled })
      .from(oauthConsent)
      .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
      .where(and(eq(oauthConsent.clientId, clientId), eq(oauthConsent.userId, userId)))
      .limit(1)
    if (!consent || consent.disabled) return null

    const granted = typeof payload.scope === "string" ? payload.scope.split(" ") : []
    const scopes = granted.filter((scope): scope is McpScope => MCP_SCOPE_SET.has(scope))
    return { userId, clientId, clientName: consent.clientName?.trim() || "AI app", scopes }
  } catch {
    return null
  }
}
