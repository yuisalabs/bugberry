import { WORKSPACE_ROLES } from "@bugberry/shared"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { forbidden, notFound, tooManyRequests } from "../../lib/errors"
import { imageUploads } from "../../lib/image-upload"
import { createRateLimiter } from "../../lib/rate-limit"
import { oneOf } from "../../lib/schema"
import { logoKeyFor } from "../../storage/keys"
import { requireMember } from "./access"
import { workspaceLimits } from "./limits"
import { name, slug } from "./model"
import {
  deletePendingLogo,
  findMember,
  findPendingLogo,
  findWorkspaceSummary,
  listMemberships,
  setPendingLogo,
  setWorkspaceLogo,
} from "./repository"
import { changeMemberRole, changeWorkspace, createOwnWorkspace, membersOf, removeMember } from "./service"
import { freeSlug, slugProblem, slugTaken } from "./slug"

/** Each workspace can send its own invitations, so new workspaces are capped too. */
const WORKSPACES_PER_PERSON_PER_HOUR = 10
const LOGO_UPLOADS_PER_WORKSPACE_PER_HOUR = 20

export function workspacesModule(deps: AppDeps) {
  const { db, config, storage } = deps
  const creations = createRateLimiter({ limit: WORKSPACES_PER_PERSON_PER_HOUR, windowMs: 60 * 60 * 1000 })

  const summary = async (workspaceId: string) => {
    const row = await findWorkspaceSummary(db, workspaceId)
    if (!row) throw notFound("workspace_not_found", "Workspace not found")
    return { ...row, slug: row.slug ?? "" }
  }
  // A workspace's logo: admins upload, replace or remove it; anyone may load it (it is just an image).
  const logos = imageUploads({
    storage,
    keyFor: logoKeyFor,
    urlFor: (workspaceId, logoId) => `${config.appUrl}/api/workspace-logos/${workspaceId}/${logoId}`,
    currentUrl: async (workspaceId) => (await summary(workspaceId)).logoUrl,
    pending: {
      find: async (workspaceId) => (await findPendingLogo(db, workspaceId))?.logoId ?? null,
      set: (workspaceId, logoId) => setPendingLogo(db, workspaceId, logoId),
      remove: (workspaceId) => deletePendingLogo(db, workspaceId),
    },
    uploadsPerHour: LOGO_UPLOADS_PER_WORKSPACE_PER_HOUR,
    copy: {
      tooLarge: "Logos can be up to 2 MB",
      invalid: "Use a PNG or JPG logo",
      notFoundCode: "logo_not_found",
      notFound: "Logo not found",
    },
  })
  const setLogo = async (workspaceId: string, url: string | null) => {
    const before = await summary(workspaceId)
    await setWorkspaceLogo(db, workspaceId, url)
    await logos.dropReplaced(workspaceId, before.logoUrl, url)
    return summary(workspaceId)
  }

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/workspaces",
      async ({ user: current }) => {
        const rows = await listMemberships(db, current.id)
        return rows.map(({ ownerId, slug: short, ...row }) => ({ ...row, slug: short ?? "", owner: ownerId === current.id }))
      },
      { auth: true },
    )
    .post(
      "/workspaces",
      async ({ user: current, body }) => {
        if (!creations.consume(current.id)) throw tooManyRequests()
        const created = await createOwnWorkspace(db, config.accountLimits, current.id, body.name.trim(), body.slug?.trim())
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
        return changeWorkspace(db, params.id, body)
      },
      { auth: true, body: t.Object({ name: t.Optional(name), slug: t.Optional(slug) }) },
    )
    .get(
      "/workspaces/:id/members",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id)
        return membersOf(db, params.id)
      },
      { auth: true },
    )
    .patch(
      "/workspaces/:id/members/:userId",
      async ({ user: current, params, body }) => {
        await requireMember(db, current.id, params.id, "admin")
        await changeMemberRole(db, params.id, params.userId, body.role)
        const updated = await findMember(db, params.id, params.userId)
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
        await removeMember(db, params.id, current.id, params.userId)
        return { ok: true }
      },
      { auth: true },
    )
    .post(
      "/workspaces/:id/logo",
      async ({ user: current, params, body }) => {
        await requireMember(db, current.id, params.id, "admin")
        const { upload, imageId } = await logos.start(params.id, body)
        return { upload, logoId: imageId }
      },
      {
        auth: true,
        body: t.Object({ contentType: t.UnionEnum(["image/png", "image/jpeg"]), size: t.Integer({ minimum: 1 }) }),
      },
    )
    .post(
      "/workspaces/:id/logo/:logoId",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id, "admin")
        return setLogo(params.id, await logos.confirm(params.id, params.logoId))
      },
      { auth: true },
    )
    .delete(
      "/workspaces/:id/logo",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id, "admin")
        return setLogo(params.id, null)
      },
      { auth: true },
    )
    // Public, like avatars: the ids are random and a logo is not a secret.
    .get("/workspace-logos/:workspaceId/:logoId", ({ params }) => logos.serve(params.workspaceId, params.logoId))
}
