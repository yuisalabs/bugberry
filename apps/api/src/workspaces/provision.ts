import { and, eq, gt, isNull } from "drizzle-orm"
import type { Db } from "../db/client"
import { user, workspace, workspaceInvitation, workspaceMember } from "../db/schema"
import { conflict, unprocessable } from "../lib/errors"
import { newId } from "../lib/ids"
import { freeSlug, isUniqueViolation, slugProblem } from "./slug"

/** A suggested slug can lose a race with another new workspace; it is picked again this many times. */
const SLUG_ATTEMPTS = 5

/** "Budi's workspace": the first word of the name, else the address's local part. */
export function defaultWorkspaceName(userName: string, email: string): string {
  const first = userName.trim().split(/\s+/)[0] || email.split("@")[0] || "My"
  return `${first}'s workspace`
}

/**
 * A new workspace owned by its creator, who is also its admin; it becomes their current workspace.
 * Without a typed slug, a free one is picked from the name.
 */
export async function createWorkspace(
  db: Db,
  ownerId: string,
  name: string,
  typedSlug?: string,
): Promise<{ id: string; name: string; slug: string }> {
  if (typedSlug !== undefined && slugProblem(typedSlug)) throw unprocessable("invalid_slug", "Use 3–40 lowercase letters, numbers or dashes")
  for (let attempt = 1; ; attempt++) {
    const slug = typedSlug ?? (await freeSlug(db, name))
    try {
      return await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(workspace)
          .values({ id: newId(), name, slug, ownerId })
          .returning({ id: workspace.id, name: workspace.name, slug: workspace.slug })
        if (!created) throw new Error("Failed to create workspace")
        await tx.insert(workspaceMember).values({ workspaceId: created.id, userId: ownerId, role: "admin" })
        await tx.update(user).set({ lastWorkspaceId: created.id }).where(eq(user.id, ownerId))
        return { ...created, slug }
      })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      if (typedSlug !== undefined) throw conflict("slug_taken", "This URL is taken")
      if (attempt >= SLUG_ATTEMPTS) throw error
    }
  }
}

/**
 * Runs once for every new account. Someone who was invited joins through the invitation instead,
 * so they get no workspace of their own; everyone else starts with one.
 */
export async function provisionNewUser(db: Db, person: { id: string; name: string; email: string }): Promise<void> {
  const [invited] = await db
    .select({ id: workspaceInvitation.id })
    .from(workspaceInvitation)
    .where(
      and(
        eq(workspaceInvitation.email, person.email.trim().toLowerCase()),
        isNull(workspaceInvitation.acceptedAt),
        isNull(workspaceInvitation.revokedAt),
        gt(workspaceInvitation.expiresAt, new Date()),
      ),
    )
    .limit(1)
  if (invited) return
  await createWorkspace(db, person.id, defaultWorkspaceName(person.name, person.email))
}
