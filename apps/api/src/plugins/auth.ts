import { Elysia } from "elysia"
import type { AppDeps } from "../deps"
import { hashToken, TOKEN_PREFIX } from "../modules/tokens/token"
import { forbidden, unauthorized } from "../lib/errors"
import { findCurrentUser } from "../modules/account/repository"
import { isEmailAllowed } from "../modules/auth/policy"
import { findActiveTokenCaller, touchTokenLastUsed } from "../modules/tokens/repository"

export interface CurrentUser {
  id: string
  email: string
  name: string
  image: string | null
  lastWorkspaceId: string | null
}

/** The caller and how they signed in: a token's kind, or null for a dashboard session cookie. */
export interface ResolvedCaller extends CurrentUser {
  tokenKind: "full" | "mcp" | null
}

export const MCP_TOKEN_ONLY = "This token only works with the BugBerry MCP server"

const LAST_USED_RESOLUTION_MS = 60_000

/**
 * Resolves the caller from a personal token (Bearer) or a Better Auth session cookie. Callers decide
 * what an MCP-kind token may do: authPlugin refuses it, the MCP route accepts it.
 */
export function createUserResolver({ db, betterAuth }: Pick<AppDeps, "db" | "betterAuth">) {
  return async function resolveUser(headers: Headers): Promise<ResolvedCaller | null> {
    const authorization = headers.get("authorization")
    if (authorization?.startsWith("Bearer ")) {
      const token = authorization.slice("Bearer ".length).trim()
      if (!token.startsWith(TOKEN_PREFIX)) return null
      const row = await findActiveTokenCaller(db, hashToken(token))
      if (!row) return null
      if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
        await touchTokenLastUsed(db, row.tokenId, new Date())
      }
      return {
        id: row.id,
        email: row.email,
        name: row.name,
        image: row.image,
        lastWorkspaceId: row.lastWorkspaceId,
        tokenKind: row.kind,
      }
    }

    const session = await betterAuth.api.getSession({ headers })
    if (!session) return null
    const row = await findCurrentUser(db, session.user.id)
    return row ? { ...row, tokenKind: null } : null
  }
}

/**
 * Adds the `auth: true` route option, which puts the signed-in `user` on the context. What they may
 * do inside a workspace is checked per route (modules/workspaces/access.ts).
 */
export function authPlugin(deps: Pick<AppDeps, "db" | "betterAuth" | "config">) {
  const resolveUser = createUserResolver(deps)
  return new Elysia({ name: "bugberry.auth" }).macro({
    auth: (_required: true) => ({
      async resolve({ request }) {
        const resolved = await resolveUser(request.headers)
        if (!resolved) throw unauthorized()
        const { tokenKind, ...current } = resolved
        if (tokenKind === "mcp") throw forbidden(MCP_TOKEN_ONLY)
        if (!isEmailAllowed(current.email, deps.config.allowedEmailDomains)) {
          throw forbidden("Your email domain is no longer allowed")
        }
        return { user: current as CurrentUser, tokenKind }
      },
    }),
  })
}
