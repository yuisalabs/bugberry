import { asc, eq } from "drizzle-orm"
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

export async function findCurrentUser(db: Db, userId: string): Promise<CurrentUser | null> {
  const [row] = await executor(db).select(currentUserColumns).from(user).where(eq(user.id, userId)).limit(1)
  return row ?? null
}

export async function updateUser(
  db: Db,
  userId: string,
  changes: Partial<Pick<typeof user.$inferInsert, "name" | "image" | "lastWorkspaceId">>,
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
