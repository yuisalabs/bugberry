import type { Visibility, WorkspaceRole } from "@bugberry/shared"
import type { Db } from "../../db/client"
import { conflict, forbidden, notFound } from "../../lib/errors"
import { findMemberRole, findOldestMembership, findProjectWorkspace, findReportAccess } from "./repository"

/** The person's role in the workspace, or null when they are not a member. */
export function memberRole(db: Db, userId: string, workspaceId: string): Promise<WorkspaceRole | null> {
  return findMemberRole(db, userId, workspaceId)
}

/**
 * The gate for anything inside a workspace. Outsiders get 404, the same answer as a workspace that
 * does not exist, so nobody can learn which workspaces or ids exist elsewhere.
 */
export async function requireMember(
  db: Db,
  userId: string,
  workspaceId: string,
  need: "member" | "admin" = "member",
): Promise<WorkspaceRole> {
  const role = await memberRole(db, userId, workspaceId)
  if (!role) throw notFound("workspace_not_found", "Workspace not found")
  if (need === "admin" && role !== "admin") throw forbidden("Admins only")
  return role
}

/** The workspace a request means: the one asked for, else the person's current one, else their oldest. */
export async function resolveWorkspace(
  db: Db,
  person: { id: string; lastWorkspaceId?: string | null },
  requested?: string,
): Promise<string> {
  if (requested) {
    await requireMember(db, person.id, requested)
    return requested
  }
  if (person.lastWorkspaceId && (await memberRole(db, person.id, person.lastWorkspaceId))) return person.lastWorkspaceId
  const oldest = await findOldestMembership(db, person.id)
  if (!oldest) throw conflict("no_workspace", "Join or create a workspace first")
  return oldest
}

/**
 * A project's workspace, after checking the caller's role there. A project in a workspace the caller
 * is not in answers "project not found", like one that does not exist.
 */
export async function requireProjectRole(
  db: Db,
  userId: string,
  projectId: string,
  need: "member" | "admin" = "member",
): Promise<string> {
  const workspaceId = await findProjectWorkspace(db, projectId)
  if (!workspaceId || !(await memberRole(db, userId, workspaceId))) throw notFound("project_not_found", "Project not found")
  await requireMember(db, userId, workspaceId, need)
  return workspaceId
}

/**
 * A report the caller may work on: it exists and they are a member of its workspace. Anything else
 * answers "report not found", whether the report is missing or belongs to another workspace.
 */
export async function requireReportMember(
  db: Db,
  userId: string,
  reportId: string,
): Promise<{ workspaceId: string; reporterId: string; reporterDomain: string | null; visibility: Visibility; role: WorkspaceRole }> {
  const row = await findReportAccess(db, reportId)
  const role = row ? await memberRole(db, userId, row.workspaceId) : null
  if (!row || !role) throw notFound("report_not_found", "Report not found")
  return { ...row, role }
}
