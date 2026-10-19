import { and, asc, eq } from "drizzle-orm"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../app"
import { authPlugin } from "../../auth/plugin"
import { project, report } from "../../db/schema"
import { badRequest, conflict, notFound } from "../../lib/errors"
import { newId } from "../../lib/ids"
import { requireMember, requireProjectRole, resolveWorkspace } from "../../workspaces/access"

const projectFields = {
  name: t.String({ minLength: 1, maxLength: 80 }),
  slug: t.String({ minLength: 1, maxLength: 40, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" }),
  /** Glob patterns such as `*.app.kantor.com/*`, used by the extension to pick a project. */
  urlPatterns: t.Array(t.String({ minLength: 1, maxLength: 200 }), { maxItems: 20 }),
}

export function projectsModule(deps: AppDeps) {
  const { db } = deps

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

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/projects",
      async ({ user: current, query }) => {
        const workspaceId = await resolveWorkspace(db, current, query.workspaceId)
        return db.select().from(project).where(eq(project.workspaceId, workspaceId)).orderBy(asc(project.name))
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
        return created
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
        return updated
      },
      { auth: true, body: t.Partial(t.Object(projectFields)) },
    )
    .delete(
      "/projects/:id",
      async ({ user, params }) => {
        await requireProjectRole(db, user.id, params.id, "admin")
        const [used] = await db.select({ id: report.id }).from(report).where(eq(report.projectId, params.id)).limit(1)
        if (used) throw conflict("project_has_reports", "Delete this project's reports first")
        const deleted = await db.delete(project).where(eq(project.id, params.id)).returning({ id: project.id })
        if (deleted.length === 0) throw notFound("project_not_found", "Project not found")
        return { ok: true }
      },
      { auth: true },
    )
}
