import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import { type Db, executor } from "../../db/client"
import { account, pendingAvatar, user } from "../../db/schema"
import type { CurrentUser } from "../../plugins/auth"

const currentUserColumns = {
  id: user.id,
  email: user.email,
  name: user.name,
  image: user.image,
  lastWorkspaceId: user.lastWorkspaceId,
}

/** Null for a deactivated account too: every session cookie and OAuth access token is resolved through here. */
export async function findCurrentUser(db: Db, userId: string): Promise<CurrentUser | null> {
  const [row] = await executor(db)
    .select(currentUserColumns)
    .from(user)
    .where(and(eq(user.id, userId), isNull(user.deactivatedAt)))
    .limit(1)
  return row ?? null
}

/** Those of `userIds` whose account is not deactivated. */
export async function activeAmong(db: Db, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return []
  const rows = await executor(db)
    .select({ id: user.id })
    .from(user)
    .where(and(inArray(user.id, userIds), isNull(user.deactivatedAt)))
  return rows.map((row) => row.id)
}

export async function isDeactivated(db: Db, userId: string): Promise<boolean> {
  const [row] = await executor(db)
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.id, userId), isNotNull(user.deactivatedAt)))
    .limit(1)
  return row !== undefined
}

export async function updateUser(
  db: Db,
  userId: string,
  changes: Partial<Pick<typeof user.$inferInsert, "name" | "image" | "lastWorkspaceId" | "lastMemberWorkspaceId">>,
): Promise<void> {
  await executor(db).update(user).set(changes).where(eq(user.id, userId))
}

/** The providers a person signed in with, oldest first. */
export async function linkedProviders(db: Db, userId: string): Promise<string[]> {
  const rows = await executor(db)
    .select({ providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, userId))
    .orderBy(asc(account.createdAt))
  return rows.map((row) => row.providerId)
}

export async function findPendingAvatar(db: Db, userId: string) {
  const [row] = await executor(db).select().from(pendingAvatar).where(eq(pendingAvatar.userId, userId)).limit(1)
  return row ?? null
}

export async function setPendingAvatar(db: Db, userId: string, avatarId: string): Promise<void> {
  await executor(db)
    .insert(pendingAvatar)
    .values({ userId, avatarId })
    .onConflictDoUpdate({ target: pendingAvatar.userId, set: { avatarId, createdAt: new Date() } })
}

export async function deletePendingAvatar(db: Db, userId: string): Promise<void> {
  await executor(db).delete(pendingAvatar).where(eq(pendingAvatar.userId, userId))
}
