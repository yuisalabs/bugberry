import { WORKSPACE_ROLES } from "@bugberry/shared"
import { and, asc, eq, sql } from "drizzle-orm"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import type { Db } from "../../db/client"
import { report, user, workspace, workspaceMember } from "../../db/schema"
import { conflict, forbidden, notFound, tooManyRequests, unprocessable } from "../../lib/errors"
import { createRateLimiter } from "../../lib/rate-limit"
import { oneOf } from "../../lib/schema"
import { requireMember } from "../../workspaces/access"
import { assertCanCreateWorkspace, workspaceLimits } from "../../workspaces/limits"
import { createWorkspace } from "../../workspaces/provision"
import { freeSlug, isUniqueViolation, slugProblem, slugTaken } from "../../workspaces/slug"

const name = t.String({ minLength: 1, maxLength: 80 })
const slug = t.String({ minLength: 1, maxLength: 60 })

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

const ownerProtected = () => conflict("owner_protected", "The workspace owner can't be removed or demoted")

/**
 * Throws when `userId` is the workspace's only admin. Locking the admin rows makes a concurrent
 * demotion or departure wait, then count again, so two admins cannot both step down and leave none.
 */
async function assertAnotherAdmin(tx: Tx, workspaceId: string, userId: string): Promise<void> {
  const admins = await tx
    .select({ userId: workspaceMember.userId })
    .from(workspaceMember)
    .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.role, "admin")))
    .for("update")
  if (admins.every((admin) => admin.userId === userId)) {
    throw conflict("last_admin", "At least one admin must remain")
  }
}

/** The workspace's owner, or null for a workspace from before owners existed. */
async function ownerOf(db: Db | Tx, workspaceId: string): Promise<string | null> {
  const [row] = await db.select({ ownerId: workspace.ownerId }).from(workspace).where(eq(workspace.id, workspaceId)).limit(1)
  return row?.ownerId ?? null
}

/** Each workspace can send its own invitations, so new workspaces are capped too. */
const WORKSPACES_PER_PERSON_PER_HOUR = 10

export function workspacesModule(deps: AppDeps) {
  const { db, config } = deps
  const creations = createRateLimiter({ limit: WORKSPACES_PER_PERSON_PER_HOUR, windowMs: 60 * 60 * 1000 })

  const memberRow = (workspaceId: string, userId: string) =>
    db
      .select({ id: user.id, name: user.name, email: user.email, image: user.image, role: workspaceMember.role })
      .from(workspaceMember)
      .innerJoin(user, eq(user.id, workspaceMember.userId))
      .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)))
      .limit(1)

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/workspaces",
      async ({ user: current }) => {
        const rows = await db
          .select({
            id: workspace.id,
            name: workspace.name,
            slug: workspace.slug,
            logoUrl: workspace.logoUrl,
            role: workspaceMember.role,
            ownerId: workspace.ownerId,
          })
          .from(workspaceMember)
          .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
          .where(eq(workspaceMember.userId, current.id))
          .orderBy(asc(workspace.name), asc(workspace.id))
        return rows.map(({ ownerId, slug: short, ...row }) => ({ ...row, slug: short ?? "", owner: ownerId === current.id }))
      },
      { auth: true },
    )
    .post(
      "/workspaces",
      async ({ user: current, body }) => {
        if (!creations.consume(current.id)) throw tooManyRequests()
        const created = await db.transaction(async (tx) => {
          // One at a time per person, so requests sent together can't all pass the owned-workspace check.
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${current.id}))`)
          await assertCanCreateWorkspace(tx, config.accountLimits, current.id)
          return createWorkspace(tx, current.id, body.name.trim(), body.slug?.trim())
        })
        return { ...created, role: "admin" as const, owner: true }
      },
      { auth: true, body: t.Object({ name, slug: t.Optional(slug) }) },
    )
    // Screenshots and recordings kept against ACCOUNT_LIMITS; { limited: false } when they don't apply.
    .get(
      "/workspaces/:id/limits",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id)
        return workspaceLimits(db, config, params.id)
      },
      { auth: true },
    )
    // What the Create workspace modal and Settings show under the URL field.
    .get(
      "/workspaces/slug",
      async ({ query }) => {
        if (query.slug === undefined) {
          return { slug: await freeSlug(db, query.name ?? "", query.except), available: true, reason: null }
        }
        const typed = query.slug.trim()
        const problem = slugProblem(typed)
        if (problem) return { slug: typed, available: false, reason: problem }
        const taken = await slugTaken(db, typed, query.except)
        return { slug: typed, available: !taken, reason: taken ? ("taken" as const) : null }
      },
      {
        auth: true,
        query: t.Object({ name: t.Optional(t.String({ maxLength: 80 })), slug: t.Optional(slug), except: t.Optional(t.String()) }),
      },
    )
    .patch(
      "/workspaces/:id",
      async ({ user: current, params, body }) => {
        await requireMember(db, current.id, params.id, "admin")
        const changes: { name?: string; slug?: string } = {}
        if (body.name !== undefined) changes.name = body.name.trim()
        if (body.slug !== undefined) {
          const typed = body.slug.trim()
          if (slugProblem(typed)) throw unprocessable("invalid_slug", "Use 3–40 lowercase letters, numbers or dashes")
          if (await slugTaken(db, typed, params.id)) throw conflict("slug_taken", "This URL is taken")
          changes.slug = typed
        }
        try {
          const [updated] = await db
            .update(workspace)
            .set(changes)
            .where(eq(workspace.id, params.id))
            .returning({ id: workspace.id, name: workspace.name, slug: workspace.slug })
          if (!updated) throw notFound("workspace_not_found", "Workspace not found")
          return { ...updated, slug: updated.slug ?? "" }
        } catch (error) {
          if (isUniqueViolation(error)) throw conflict("slug_taken", "This URL is taken")
          throw error
        }
      },
      { auth: true, body: t.Object({ name: t.Optional(name), slug: t.Optional(slug) }) },
    )
    .get(
      "/workspaces/:id/members",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id)
        const ownerId = await ownerOf(db, params.id)
        const rows = await db
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            role: workspaceMember.role,
            joinedAt: workspaceMember.createdAt,
          })
          .from(workspaceMember)
          .innerJoin(user, eq(user.id, workspaceMember.userId))
          .where(eq(workspaceMember.workspaceId, params.id))
          .orderBy(asc(user.name), asc(user.email))
        return rows.map((row) => ({ ...row, owner: row.id === ownerId }))
      },
      { auth: true },
    )
    .patch(
      "/workspaces/:id/members/:userId",
      async ({ user: current, params, body }) => {
        await requireMember(db, current.id, params.id, "admin")
        await db.transaction(async (tx) => {
          const [target] = await tx
            .select({ role: workspaceMember.role })
            .from(workspaceMember)
            .where(and(eq(workspaceMember.workspaceId, params.id), eq(workspaceMember.userId, params.userId)))
            .limit(1)
          if (!target) throw notFound("member_not_found", "Member not found")
          if ((await ownerOf(tx, params.id)) === params.userId) throw ownerProtected()
          if (target.role === "admin" && body.role === "member") await assertAnotherAdmin(tx, params.id, params.userId)
          await tx
            .update(workspaceMember)
            .set({ role: body.role })
            .where(and(eq(workspaceMember.workspaceId, params.id), eq(workspaceMember.userId, params.userId)))
        })
        const [updated] = await memberRow(params.id, params.userId)
        if (!updated) throw notFound("member_not_found", "Member not found")
        // The owner's role never changes, so whoever was just changed is not the owner.
        return { ...updated, owner: false }
      },
      { auth: true, body: t.Object({ role: oneOf(WORKSPACE_ROLES) }) },
    )
    .delete(
      "/workspaces/:id/members/:userId",
      async ({ user: current, params }) => {
        const role = await requireMember(db, current.id, params.id)
        // Admins remove anyone; everyone else may only leave.
        if (params.userId !== current.id && role !== "admin") throw forbidden("Only an admin can remove members")
        await db.transaction(async (tx) => {
          const [target] = await tx
            .select({ role: workspaceMember.role })
            .from(workspaceMember)
            .where(and(eq(workspaceMember.workspaceId, params.id), eq(workspaceMember.userId, params.userId)))
            .limit(1)
          if (!target) throw notFound("member_not_found", "Member not found")
          if ((await ownerOf(tx, params.id)) === params.userId) {
            throw params.userId === current.id
              ? conflict("owner_cannot_leave", "The workspace owner can't leave the workspace")
              : ownerProtected()
          }
          if (target.role === "admin") await assertAnotherAdmin(tx, params.id, params.userId)
          await tx
            .delete(workspaceMember)
            .where(and(eq(workspaceMember.workspaceId, params.id), eq(workspaceMember.userId, params.userId)))
          // Their reports stay; work assigned to them in this workspace goes back to nobody.
          await tx
            .update(report)
            .set({ assigneeId: null })
            .where(and(eq(report.workspaceId, params.id), eq(report.assigneeId, params.userId)))
          await tx
            .update(user)
            .set({ lastWorkspaceId: null })
            .where(and(eq(user.id, params.userId), eq(user.lastWorkspaceId, params.id)))
        })
        return { ok: true }
      },
      { auth: true },
    )
}
