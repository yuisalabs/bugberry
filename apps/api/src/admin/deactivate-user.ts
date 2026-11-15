import { and, asc, eq, inArray, isNull, notInArray } from "drizzle-orm"
import type { Db } from "../db/client"
import { apiToken, oauthAccessToken, oauthConsent, oauthRefreshToken, session, user, workspace, workspaceMember } from "../db/schema"

/**
 * Cuts an account off: no sign-in by any method, and every session, personal token and AI app connection
 * it had is gone. Reports, comments, memberships and assignments stay. It never refuses; workspaces left
 * with no active admin are reported for `promote-admin`.
 */
export async function deactivateUser(
  db: Db,
  email: string,
): Promise<{ userId: string; email: string; alreadyDeactivated: boolean; withoutAdmin: Array<{ name: string; slug: string }> }> {
  const normalized = email.trim().toLowerCase()
  return db.transaction(async (tx) => {
    const [person] = await tx
      .select({ id: user.id, email: user.email, deactivatedAt: user.deactivatedAt })
      .from(user)
      .where(eq(user.email, normalized))
      .limit(1)
    if (!person) throw new Error(`No account with the email ${normalized}`)
    if (!person.deactivatedAt) await tx.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, person.id))

    // Run on every call, so a second run also clears anything that appeared since the first.
    await tx.delete(session).where(eq(session.userId, person.id))
    await tx.update(apiToken).set({ revokedAt: new Date() }).where(and(eq(apiToken.userId, person.id), isNull(apiToken.revokedAt)))
    await tx.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, person.id))
    await tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, person.id))
    await tx.delete(oauthConsent).where(eq(oauthConsent.userId, person.id))

    const wasAdminOf = tx
      .select({ id: workspaceMember.workspaceId })
      .from(workspaceMember)
      .where(and(eq(workspaceMember.userId, person.id), eq(workspaceMember.role, "admin")))
    const hasActiveAdmin = tx
      .select({ id: workspaceMember.workspaceId })
      .from(workspaceMember)
      .innerJoin(user, eq(user.id, workspaceMember.userId))
      .where(and(eq(workspaceMember.role, "admin"), isNull(user.deactivatedAt)))
    const stranded = await tx
      .select({ name: workspace.name, slug: workspace.slug })
      .from(workspace)
      .where(and(inArray(workspace.id, wasAdminOf), notInArray(workspace.id, hasActiveAdmin)))
      .orderBy(asc(workspace.name))

    return {
      userId: person.id,
      email: person.email,
      alreadyDeactivated: person.deactivatedAt !== null,
      withoutAdmin: stranded.map((row) => ({ name: row.name, slug: row.slug ?? "" })),
    }
  })
}

/** Lets a deactivated account sign in again. Tokens revoked by deactivating stay revoked. */
export async function reactivateUser(db: Db, email: string): Promise<{ userId: string; email: string; wasDeactivated: boolean }> {
  const normalized = email.trim().toLowerCase()
  return db.transaction(async (tx) => {
    const [person] = await tx
      .select({ id: user.id, email: user.email, deactivatedAt: user.deactivatedAt })
      .from(user)
      .where(eq(user.email, normalized))
      .limit(1)
    if (!person) throw new Error(`No account with the email ${normalized}`)
    if (person.deactivatedAt) await tx.update(user).set({ deactivatedAt: null }).where(eq(user.id, person.id))
    return { userId: person.id, email: person.email, wasDeactivated: person.deactivatedAt !== null }
  })
}
