import { and, eq } from "drizzle-orm"
import type { Db } from "../db/client"
import { user, workspace, workspaceMember } from "../db/schema"

/**
 * Makes someone an admin of a workspace, adding them to it if needed: the way back into a workspace
 * whose only admin left. The owner stays who it was.
 */
export async function promoteAdmin(
  db: Db,
  workspaceSlug: string,
  email: string,
): Promise<{ workspace: string; email: string; added: boolean }> {
  const slug = workspaceSlug.trim().toLowerCase()
  const normalized = email.trim().toLowerCase()
  return db.transaction(async (tx) => {
    const [target] = await tx.select({ id: workspace.id, name: workspace.name }).from(workspace).where(eq(workspace.slug, slug)).limit(1)
    if (!target) throw new Error(`No workspace with the URL ${slug}`)
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
    return { workspace: target.name, email: person.email, added: member === undefined }
  })
}
