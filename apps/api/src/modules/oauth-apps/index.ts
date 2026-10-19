import { and, desc, eq, max } from "drizzle-orm"
import { Elysia } from "elysia"
import type { AppDeps } from "../../app"
import { authPlugin } from "../../auth/plugin"
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from "../../db/schema"
import { forbidden, notFound } from "../../lib/errors"

/** The AI apps a person allowed through OAuth, and revoking them. Dashboard sessions only. */
export function oauthAppsModule(deps: AppDeps) {
  const { db } = deps
  const requireSession = (tokenKind: "full" | "mcp" | null) => {
    if (tokenKind !== null) throw forbidden("Manage connected apps from the BugBerry dashboard")
  }

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/me/oauth-apps",
      async ({ user, tokenKind }) => {
        requireSession(tokenKind)
        // Access tokens are JWTs and never stored; the newest refresh token shows when the app last renewed its access.
        const lastToken = db
          .select({ clientId: oauthRefreshToken.clientId, at: max(oauthRefreshToken.createdAt).as("at") })
          .from(oauthRefreshToken)
          .where(eq(oauthRefreshToken.userId, user.id))
          .groupBy(oauthRefreshToken.clientId)
          .as("last_token")
        const rows = await db
          .select({
            clientId: oauthConsent.clientId,
            name: oauthClient.name,
            uri: oauthClient.uri,
            scopes: oauthConsent.scopes,
            grantedAt: oauthConsent.createdAt,
            lastUsedAt: lastToken.at,
          })
          .from(oauthConsent)
          .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
          .leftJoin(lastToken, eq(lastToken.clientId, oauthConsent.clientId))
          .where(eq(oauthConsent.userId, user.id))
          .orderBy(desc(oauthConsent.createdAt))
        return rows.map((row) => ({ ...row, name: row.name?.trim() || "AI app" }))
      },
      { auth: true },
    )
    .delete(
      "/me/oauth-apps/:clientId",
      async ({ user, tokenKind, params }) => {
        requireSession(tokenKind)
        // Consent and every token go together: the MCP route also checks the consent, so access ends at once.
        const removed = await db.transaction(async (tx) => {
          const mine = (table: typeof oauthAccessToken | typeof oauthRefreshToken) =>
            and(eq(table.userId, user.id), eq(table.clientId, params.clientId))
          await tx.delete(oauthAccessToken).where(mine(oauthAccessToken))
          await tx.delete(oauthRefreshToken).where(mine(oauthRefreshToken))
          return tx
            .delete(oauthConsent)
            .where(and(eq(oauthConsent.userId, user.id), eq(oauthConsent.clientId, params.clientId)))
            .returning({ id: oauthConsent.id })
        })
        if (removed.length === 0) throw notFound("oauth_app_not_found", "Connected app not found")
        return { ok: true }
      },
      { auth: true },
    )
}
