import type { AccessRole, Visibility, WorkspaceRole } from "@bugberry/shared"
import type { Db } from "../../db/client"
import { conflict, forbidden, notFound } from "../../lib/errors"
import { findOldestGuestWorkspace, listGuestProjectIds } from "../guests/repository"
import { findLastMemberWorkspace, findMemberRole, findOldestMembership, findProjectWorkspace, findReportAccess } from "./repository"

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

/**
 * The workspace a request means: the one asked for, else the person's current one, else the last one they opened as a
 * member (the current one may be a guest workspace), else their oldest.
 */
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
  const fallback = (await findLastMemberWorkspace(db, person.id)) ?? (await findOldestMembership(db, person.id))
  if (!fallback) throw conflict("no_workspace", "Join or create a workspace first")
  return fallback
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

/** What someone sees of a workspace: all of it as a member, or the projects they are a guest of. */
export type Scope = { role: WorkspaceRole; projects: "all" } | { role: "guest"; projects: string[] }

/** What the person sees of the workspace, or null when nothing. A guest with no project left sees nothing. */
export async function workspaceScope(db: Db, userId: string, workspaceId: string): Promise<Scope | null> {
  const role = await memberRole(db, userId, workspaceId)
  if (role) return { role, projects: "all" }
  const projects = await listGuestProjectIds(db, userId, workspaceId)
  return projects.length > 0 ? { role: "guest", projects } : null
}

/**
 * resolveWorkspace for the routes guests may use: the workspace asked for, else the current one, else the last member
 * workspace, else the oldest membership, else the oldest guest workspace. Nothing seen answers like a workspace that doesn't exist.
 */
export async function requireScope(
  db: Db,
  person: { id: string; lastWorkspaceId?: string | null },
  requested?: string,
): Promise<{ workspaceId: string; scope: Scope }> {
  if (requested) {
    const scope = await workspaceScope(db, person.id, requested)
    if (!scope) throw notFound("workspace_not_found", "Workspace not found")
    return { workspaceId: requested, scope }
  }
  if (person.lastWorkspaceId) {
    const scope = await workspaceScope(db, person.id, person.lastWorkspaceId)
    if (scope) return { workspaceId: person.lastWorkspaceId, scope }
  }
  const fallback =
    (await findLastMemberWorkspace(db, person.id)) ?? (await findOldestMembership(db, person.id)) ?? (await findOldestGuestWorkspace(db, person.id))
  const scope = fallback ? await workspaceScope(db, person.id, fallback) : null
  if (!fallback || !scope) throw conflict("no_workspace", "Join or create a workspace first")
  return { workspaceId: fallback, scope }
}

/** Whether the scope reaches a report of this project; a report without a project is for members only. */
export function scopeReaches(scope: Scope, projectId: string | null): boolean {
  return scope.projects === "all" || (projectId !== null && scope.projects.includes(projectId))
}

/**
 * requireReportMember for the routes guests may use: a member of the report's workspace, or a guest of its project.
 * Anything else answers "report not found".
 */
export async function requireReportReader(
  db: Db,
  userId: string,
  reportId: string,
): Promise<{ workspaceId: string; projectId: string | null; reporterId: string; reporterDomain: string | null; visibility: Visibility; role: AccessRole }> {
  const row = await findReportAccess(db, reportId)
  const scope = row ? await workspaceScope(db, userId, row.workspaceId) : null
  if (!row || !scope || !scopeReaches(scope, row.projectId)) throw notFound("report_not_found", "Report not found")
  return { ...row, role: scope.role }
}
