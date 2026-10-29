import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { generateApiToken, hashToken } from "./token"
import { conflict, forbidden, notFound } from "../../lib/errors"
import { countActiveMcpTokens, insertMcpToken, listActiveMcpTokens, revokeMcpToken } from "./repository"

const MAX_ACTIVE_TOKENS = 25

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
        if ((await countActiveMcpTokens(db, user.id)) >= MAX_ACTIVE_TOKENS) throw conflict("too_many_tokens", "Revoke a token before making another")
        const token = generateApiToken()
        const row = await insertMcpToken(db, { userId: user.id, tokenHash: hashToken(token), label: body.label.trim() })
        if (!row) throw new Error("failed to insert token")
        return { ...row, token }
      },
      { auth: true, body: t.Object({ label: t.String({ minLength: 1, maxLength: 60 }) }) },
    )
    .delete(
      "/me/tokens/:id",
      async ({ user, tokenKind, params }) => {
        requireSession(tokenKind)
        if (!(await revokeMcpToken(db, user.id, params.id))) throw notFound("token_not_found", "Token not found")
        return { ok: true }
      },
      { auth: true },
    )
}
