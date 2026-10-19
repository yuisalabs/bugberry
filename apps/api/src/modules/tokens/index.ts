import { and, count, desc, eq, isNull } from "drizzle-orm"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../app"
import { authPlugin } from "../../auth/plugin"
import { apiToken } from "../../db/schema"
import { generateApiToken, hashToken } from "../../lib/api-token"
import { conflict, forbidden, notFound } from "../../lib/errors"
import { newId } from "../../lib/ids"

const MAX_ACTIVE_TOKENS = 25

/** Personal tokens for AI agents without OAuth. They only work on /api/mcp; the secret is shown once. */
export function tokensModule(deps: AppDeps) {
  const { db } = deps
  const mine = (userId: string) => and(eq(apiToken.userId, userId), eq(apiToken.kind, "mcp"), isNull(apiToken.revokedAt))
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
        return db
          .select({ id: apiToken.id, label: apiToken.label, createdAt: apiToken.createdAt, lastUsedAt: apiToken.lastUsedAt })
          .from(apiToken)
          .where(mine(user.id))
          .orderBy(desc(apiToken.createdAt), desc(apiToken.id))
      },
      { auth: true },
    )
    .post(
      "/me/tokens",
      async ({ user, tokenKind, body }) => {
        requireSession(tokenKind)
        const [active] = await db.select({ value: count() }).from(apiToken).where(mine(user.id))
        if ((active?.value ?? 0) >= MAX_ACTIVE_TOKENS) throw conflict("too_many_tokens", "Revoke a token before making another")
        const token = generateApiToken()
        const [row] = await db
          .insert(apiToken)
          .values({ id: newId(), userId: user.id, tokenHash: hashToken(token), label: body.label.trim(), kind: "mcp" })
          .returning({ id: apiToken.id, label: apiToken.label, createdAt: apiToken.createdAt })
        if (!row) throw new Error("failed to insert token")
        return { ...row, token }
      },
      { auth: true, body: t.Object({ label: t.String({ minLength: 1, maxLength: 60 }) }) },
    )
    .delete(
      "/me/tokens/:id",
      async ({ user, tokenKind, params }) => {
        requireSession(tokenKind)
        const revoked = await db
          .update(apiToken)
          .set({ revokedAt: new Date() })
          .where(and(eq(apiToken.id, params.id), mine(user.id)))
          .returning({ id: apiToken.id })
        if (revoked.length === 0) throw notFound("token_not_found", "Token not found")
        return { ok: true }
      },
      { auth: true },
    )
}
