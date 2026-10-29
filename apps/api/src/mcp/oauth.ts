/**
 * Access tokens from Better Auth's mcp() plugin are EdDSA JWTs signed with the keys jwt() keeps in the
 * `jwks` table: sub = user id, client_id = the AI app, aud includes `${APP_URL}/api/mcp`, iss =
 * `${APP_URL}/api/auth`, scope = space-separated. They are verified here in-process against those keys
 * (no HTTP round trip to /api/auth/jwks), and the person's consent must still exist, so revoking an app
 * in the dashboard stops its tokens at once instead of when they expire.
 */
import { cleanAppName } from "@bugberry/shared"
import { and, eq } from "drizzle-orm"
import { createLocalJWKSet, decodeProtectedHeader, type JSONWebKeySet, jwtVerify } from "jose"
import type { AppDeps } from "../deps"
import { mcpResource } from "../modules/auth/mcp-oauth"
import { oauthClient, oauthConsent } from "../db/schema"
import type { McpScope } from "./context"

export interface VerifiedOAuthToken {
  userId: string
  clientId: string
  clientName: string
  scopes: McpScope[]
}

const MCP_SCOPE_SET = new Set<string>(["bugberry:read", "bugberry:write"])

export interface KeyCache {
  /** The signing keys, from the cache unless it is stale or `fresh` is asked for. */
  get(load: () => Promise<JSONWebKeySet>, fresh?: boolean): Promise<JSONWebKeySet>
  /** Puts a key set in the cache, for tests. */
  prime(keys: JSONWebKeySet): void
}

/**
 * The public signing keys, kept for a minute: reading them is a database query, and every MCP request
 * with an OAuth token (including garbage ones, before any rate limit) needs them.
 */
export function createKeyCache(opts: { ttlMs?: number; minRefreshMs?: number; now?: () => number } = {}): KeyCache {
  const ttlMs = opts.ttlMs ?? 60_000
  // Forged tokens can name any key id; they may force a fresh read at most this often.
  const minRefreshMs = opts.minRefreshMs ?? 1000
  const now = opts.now ?? Date.now
  let cached: { keys: JSONWebKeySet; loadedAt: number } | null = null
  const store = (keys: JSONWebKeySet, loadedAt: number) => {
    cached = { keys, loadedAt }
    return keys
  }
  return {
    async get(load, fresh = false) {
      const at = now()
      if (cached) {
        const age = at - cached.loadedAt
        if (age < ttlMs && (!fresh || age < minRefreshMs)) return cached.keys
      }
      return store(await load(), at)
    },
    prime(keys) {
      // Primed keys count as old, so the first unknown key id may refresh them at once.
      store(keys, now() - minRefreshMs)
    },
  }
}

export async function verifyOAuthAccessToken(
  deps: Pick<AppDeps, "betterAuth" | "db" | "config">,
  token: string,
  keyCache: KeyCache,
): Promise<VerifiedOAuthToken | null> {
  try {
    const load = async () => (await deps.betterAuth.api.getJwks()) as JSONWebKeySet
    let keys = await keyCache.get(load)
    // A key id the cache doesn't know means the keys rotated since the last read: read them once more.
    const { kid } = decodeProtectedHeader(token)
    if (kid && !keys.keys.some((key) => key.kid === kid)) keys = await keyCache.get(load, true)
    const { payload } = await jwtVerify(token, createLocalJWKSet(keys), {
      issuer: `${deps.config.appUrl}/api/auth`,
      audience: mcpResource(deps.config),
      currentDate: new Date(Date.now()),
    })
    const userId = typeof payload.sub === "string" ? payload.sub : null
    const clientId = typeof payload.client_id === "string" ? payload.client_id : typeof payload.azp === "string" ? payload.azp : null
    if (!userId || !clientId) return null

    const [consent] = await deps.db
      .select({ id: oauthConsent.id, scopes: oauthConsent.scopes, clientName: oauthClient.name, disabled: oauthClient.disabled })
      .from(oauthConsent)
      .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
      .where(and(eq(oauthConsent.clientId, clientId), eq(oauthConsent.userId, userId)))
      .limit(1)
    if (!consent || consent.disabled) return null

    // What the token says, but never more than the person allows now: narrowing a consent applies at once.
    const allowed = new Set(consent.scopes)
    const granted = typeof payload.scope === "string" ? payload.scope.split(" ") : []
    const scopes = granted.filter((scope): scope is McpScope => MCP_SCOPE_SET.has(scope) && allowed.has(scope))
    return { userId, clientId, clientName: cleanAppName(consent.clientName), scopes }
  } catch {
    return null
  }
}
