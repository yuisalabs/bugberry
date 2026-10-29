import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { badRequest, conflict, notFound } from "../../lib/errors"
import { imageIdType } from "../../lib/image-upload"
import { projectLogoKeyFor } from "../../storage/keys"
import { requireMember, requireProjectRole, resolveWorkspace } from "../workspaces/access"
import { projectFields } from "./model"
import {
  deleteProject,
  insertProject,
  listProjectPatterns,
  listProjects,
  projectHasReports,
  reportPagesByProject,
  reportStatsByProject,
  updateProject,
} from "./repository"
import { assertSlugFree, projectView } from "./service"
import { unmatchedPages } from "./unmatched"

export function projectsModule(deps: AppDeps) {
  const { db, storage } = deps

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/projects",
      async ({ user: current, query }) => {
        const workspaceId = await resolveWorkspace(db, current, query.workspaceId)
        const rows = await listProjects(db, workspaceId)
        return rows.map(projectView)
      },
      { auth: true, query: t.Object({ workspaceId: t.Optional(t.String({ minLength: 1 })) }) },
    )
    // The Projects page: each project's report counts, and the pages no URL pattern catches. Admins only, like the page.
    .get(
      "/projects/overview",
      async ({ user: current, query }) => {
        const workspaceId = await resolveWorkspace(db, current, query.workspaceId)
        await requireMember(db, current.id, workspaceId, "admin")
        const [projects, stats, pages] = await Promise.all([
          listProjectPatterns(db, workspaceId),
          reportStatsByProject(db, workspaceId),
          reportPagesByProject(db, workspaceId),
        ])
        return {
          stats: stats.flatMap((row) =>
            row.projectId && row.lastReportAt
              ? [{ projectId: row.projectId, reports: row.reports, open: row.open, lastReportAt: row.lastReportAt }]
              : [],
          ),
          unmatched: unmatchedPages(
            pages.flatMap((row) => (row.lastReportAt ? [{ ...row, lastReportAt: row.lastReportAt }] : [])),
            projects,
          ),
        }
      },
      { auth: true, query: t.Object({ workspaceId: t.Optional(t.String({ minLength: 1 })) }) },
    )
    .post(
      "/projects",
      async ({ user, body: { workspaceId: requested, ...fields } }) => {
        const workspaceId = await resolveWorkspace(db, user, requested)
        await requireMember(db, user.id, workspaceId, "admin")
        await assertSlugFree(db, workspaceId, fields.slug)
        return projectView(await insertProject(db, workspaceId, fields))
      },
      { auth: true, body: t.Object({ workspaceId: t.Optional(t.String({ minLength: 1 })), ...projectFields }) },
    )
    .patch(
      "/projects/:id",
      async ({ user, params, body }) => {
        const workspaceId = await requireProjectRole(db, user.id, params.id, "admin")
        if (Object.values(body).every((value) => value === undefined)) {
          throw badRequest("empty_update", "Nothing to update")
        }
        if (body.slug) await assertSlugFree(db, workspaceId, body.slug, params.id)
        const updated = await updateProject(db, params.id, body)
        if (!updated) throw notFound("project_not_found", "Project not found")
        return projectView(updated)
      },
      { auth: true, body: t.Partial(t.Object(projectFields)) },
    )
    .delete(
      "/projects/:id",
      async ({ user, params }) => {
        await requireProjectRole(db, user.id, params.id, "admin")
        if (await projectHasReports(db, params.id)) throw conflict("project_has_reports", "Delete this project's reports first")
        const deleted = await deleteProject(db, params.id)
        if (!deleted) throw notFound("project_not_found", "Project not found")
        // Its uploaded logo goes with it; the link ends in the logo's id.
        const logoId = deleted.logoUrl?.split("/").pop() ?? ""
        if (imageIdType(logoId)) await storage.delete(projectLogoKeyFor(params.id, logoId)).catch(() => {})
        return { ok: true }
      },
      { auth: true },
    )
}
