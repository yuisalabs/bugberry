import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { forbidden } from "../../lib/errors"
import { listActiveMcpTokens } from "./repository"
import { createMcpToken, revokeToken } from "./service"

/** Personal tokens for AI agents without OAuth. They only work on /api/mcp; the secret is shown once. */
export function tokensModule(deps: AppDeps) {
  const { db } = deps
  /** A token must not mint or revoke tokens: only someone signed in to the dashboard may. */
  const requireSession = (tokenKind: "full" | "mcp" | null) => {
    if (tokenKind !== null) throw forbidden("Manage tokens from the BugBerry dashboard")
  }

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/me/tokens",
      async ({ user, tokenKind }) => {
        requireSession(tokenKind)
        return listActiveMcpTokens(db, user.id)
      },
      { auth: true },
    )
    .post(
      "/me/tokens",
      async ({ user, tokenKind, body }) => {
        requireSession(tokenKind)
        return createMcpToken(db, user.id, body.label)
      },
      { auth: true, body: t.Object({ label: t.String({ minLength: 1, maxLength: 60 }) }) },
    )
    .delete(
      "/me/tokens/:id",
      async ({ user, tokenKind, params }) => {
        requireSession(tokenKind)
        return revokeToken(db, user.id, params.id)
      },
      { auth: true },
    )
}
