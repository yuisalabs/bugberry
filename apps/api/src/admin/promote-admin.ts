import { and, eq, or } from "drizzle-orm"
import { type Db, executor, withTransaction } from "../db/client"
import { user, workspace, workspaceMember } from "../db/schema"
import { deleteGuestsInWorkspace } from "../modules/guests/repository"

/**
 * Makes someone an admin of a workspace, adding them to it if needed: the way back into a workspace
 * whose only admin left. The owner stays who it was.
 */
export async function promoteAdmin(
  db: Db,
  /** The workspace's URL name, or its id for one that has none. */
  workspaceRef: string,
  email: string,
): Promise<{ workspace: string; email: string; added: boolean }> {
  const ref = workspaceRef.trim()
  const normalized = email.trim().toLowerCase()
  return withTransaction(db, async () => {
    const tx = executor(db)
    const [target] = await tx
      .select({ id: workspace.id, name: workspace.name })
      .from(workspace)
      .where(or(eq(workspace.slug, ref.toLowerCase()), eq(workspace.id, ref)))
      .limit(1)
    if (!target) throw new Error(`No workspace with the URL ${ref}`)
    const [person] = await tx
      .select({ id: user.id, email: user.email, deactivatedAt: user.deactivatedAt })
      .from(user)
      .where(eq(user.email, normalized))
      .limit(1)
    if (!person) throw new Error(`No account with the email ${normalized}`)
    if (person.deactivatedAt) throw new Error(`${person.email} is deactivated`)

    const [member] = await tx
      .select({ role: workspaceMember.role })
      .from(workspaceMember)
      .where(and(eq(workspaceMember.workspaceId, target.id), eq(workspaceMember.userId, person.id)))
      .limit(1)
    await tx
      .insert(workspaceMember)
      .values({ workspaceId: target.id, userId: person.id, role: "admin" })
      .onConflictDoUpdate({ target: [workspaceMember.workspaceId, workspaceMember.userId], set: { role: "admin" } })
    // A member is never also a guest of the workspace's projects.
    await deleteGuestsInWorkspace(db, person.id, target.id)
    return { workspace: target.name, email: person.email, added: member === undefined }
  })
}
