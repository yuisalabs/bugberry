import { and, desc, eq, max } from "drizzle-orm"
import { type Db, executor, withTransaction } from "../../db/client"
import { oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from "../../db/schema"

/** The apps a person allowed, newest first, with when each last renewed its access. */
export function listConsentedApps(db: Db, userId: string) {
  const x = executor(db)
  // Access tokens are JWTs and never stored; the newest refresh token shows when the app last renewed its access.
  const lastToken = x
    .select({ clientId: oauthRefreshToken.clientId, at: max(oauthRefreshToken.createdAt).as("at") })
    .from(oauthRefreshToken)
    .where(eq(oauthRefreshToken.userId, userId))
    .groupBy(oauthRefreshToken.clientId)
    .as("last_token")
  return x
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
    .where(eq(oauthConsent.userId, userId))
    .orderBy(desc(oauthConsent.createdAt))
}

/** Removes the consent and every token of the app together; true when there was a consent. */
export function revokeConsentedApp(db: Db, userId: string, clientId: string): Promise<boolean> {
  return withTransaction(db, async () => {
    const x = executor(db)
    const mine = (table: typeof oauthAccessToken | typeof oauthRefreshToken) =>
      and(eq(table.userId, userId), eq(table.clientId, clientId))
    await x.delete(oauthAccessToken).where(mine(oauthAccessToken))
    await x.delete(oauthRefreshToken).where(mine(oauthRefreshToken))
    const removed = await x
      .delete(oauthConsent)
      .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
      .returning({ id: oauthConsent.id })
    return removed.length > 0
  })
}
