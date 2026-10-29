import { and, asc, count, desc, eq, max, sql } from "drizzle-orm"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { project, report } from "../../db/schema"
import { badRequest, conflict, notFound } from "../../lib/errors"
import { newId } from "../../lib/ids"
import { imageIdType } from "../../lib/image-upload"
import { projectLogoKeyFor } from "../../storage/keys"
import { requireMember, requireProjectRole, resolveWorkspace } from "../../workspaces/access"
import { unmatchedPages } from "./unmatched"

const projectFields = {
  name: t.String({ minLength: 1, maxLength: 80 }),
  slug: t.String({ minLength: 1, maxLength: 40, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }),
  /** Glob patterns such as `*.app.kantor.com/*`, used by the extension to pick a project. */
  urlPatterns: t.Array(t.String({ minLength: 1, maxLength: 200 }), { maxItems: 20 }),
}

export function projectsModule(deps: AppDeps) {
  const { db, storage } = deps

  /** Slugs are unique within a workspace. */
  const assertSlugFree = async (workspaceId: string, slug: string, exceptId?: string) => {
    const [existing] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.workspaceId, workspaceId), eq(project.slug, slug)))
      .limit(1)
    if (existing && existing.id !== exceptId) {
      throw conflict("slug_taken", "Slug is already used by another project")
    }
  }

  /** A project as the API shows it; its AI default template is read and set through /workspaces/:id/ai. */
  const projectView = ({ aiTemplateId: _aiTemplateId, ...row }: typeof project.$inferSelect) => row

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/projects",
      async ({ user: current, query }) => {
        const workspaceId = await resolveWorkspace(db, current, query.workspaceId)
        const rows = await db.select().from(project).where(eq(project.workspaceId, workspaceId)).orderBy(asc(project.name))
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
        const ready = and(eq(report.workspaceId, workspaceId), eq(report.uploadStatus, "ready"))
        const [projects, stats, pages] = await Promise.all([
          db.select({ id: project.id, urlPatterns: project.urlPatterns }).from(project).where(eq(project.workspaceId, workspaceId)),
          db
            .select({
              projectId: report.projectId,
              reports: count(),
              open: sql<number>`count(*) filter (where ${report.status} = 'open')`.mapWith(Number),
              lastReportAt: max(report.createdAt),
            })
            .from(report)
            .where(ready)
            .groupBy(report.projectId),
          // One row per address and project; the newest addresses first, so a huge workspace still sees its recent pages.
          db
            .select({ pageUrl: report.pageUrl, projectId: report.projectId, reports: count(), lastReportAt: max(report.createdAt) })
            .from(report)
            .where(ready)
            .groupBy(report.pageUrl, report.projectId)
            .orderBy(desc(max(report.createdAt)))
            .limit(5000),
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
        await assertSlugFree(workspaceId, fields.slug)
        const [created] = await db.insert(project).values({ id: newId(), workspaceId, ...fields }).returning()
        if (!created) throw new Error("Failed to create project")
        return projectView(created)
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
        if (body.slug) await assertSlugFree(workspaceId, body.slug, params.id)
        const [updated] = await db.update(project).set(body).where(eq(project.id, params.id)).returning()
        if (!updated) throw notFound("project_not_found", "Project not found")
        return projectView(updated)
      },
      { auth: true, body: t.Partial(t.Object(projectFields)) },
    )
    .delete(
      "/projects/:id",
      async ({ user, params }) => {
        await requireProjectRole(db, user.id, params.id, "admin")
        const [used] = await db.select({ id: report.id }).from(report).where(eq(report.projectId, params.id)).limit(1)
        if (used) throw conflict("project_has_reports", "Delete this project's reports first")
        const deleted = await db.delete(project).where(eq(project.id, params.id)).returning({ id: project.id, logoUrl: project.logoUrl })
        if (deleted.length === 0) throw notFound("project_not_found", "Project not found")
        // Its uploaded logo goes with it; the link ends in the logo's id.
        const logoId = deleted[0]?.logoUrl?.split("/").pop() ?? ""
        if (imageIdType(logoId)) await storage.delete(projectLogoKeyFor(params.id, logoId)).catch(() => {})
        return { ok: true }
      },
      { auth: true },
    )
}
