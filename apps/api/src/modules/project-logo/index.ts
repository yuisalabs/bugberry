import { eq } from "drizzle-orm"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { pendingProjectLogo, project } from "../../db/schema"
import { notFound, payloadTooLarge, tooManyRequests, unprocessable } from "../../lib/errors"
import { newId } from "../../lib/ids"
import { checkUploadedImage, IMAGE_EXTENSIONS, imageIdType, MAX_IMAGE_BYTES } from "../../lib/image-upload"
import { createRateLimiter } from "../../lib/rate-limit"
import { projectLogoKeyFor } from "../../storage/keys"
import { requireProjectRole } from "../workspaces/access"

/** Each upload target lets an admin put up to 2 MB in storage, so they are capped per project. */
const UPLOADS_PER_PROJECT_PER_HOUR = 20

/** A project's logo, as a workspace's: admins upload, replace or remove it; anyone may load it (it is just an image). */
export function projectLogoModule(deps: AppDeps) {
  const { db, storage, config } = deps
  const uploads = createRateLimiter({ limit: UPLOADS_PER_PROJECT_PER_HOUR, windowMs: 60 * 60 * 1000 })
  const logoUrl = (projectId: string, logoId: string) => `${config.appUrl}/api/project-logos/${projectId}/${logoId}`

  const current = async (projectId: string) => {
    const [row] = await db.select().from(project).where(eq(project.id, projectId)).limit(1)
    if (!row) throw notFound("project_not_found", "Project not found")
    return row
  }
  /** The storage key behind a logo link of this project, or null for none. */
  const uploadedKey = (projectId: string, url: string | null) => {
    const prefix = logoUrl(projectId, "")
    if (!url?.startsWith(prefix)) return null
    const logoId = url.slice(prefix.length)
    return imageIdType(logoId) ? projectLogoKeyFor(projectId, logoId) : null
  }
  const setLogo = async (projectId: string, url: string | null) => {
    const before = await current(projectId)
    const [updated] = await db.update(project).set({ logoUrl: url }).where(eq(project.id, projectId)).returning()
    const old = uploadedKey(projectId, before.logoUrl)
    if (old && old !== uploadedKey(projectId, url)) await storage.delete(old).catch(() => {})
    if (!updated) throw notFound("project_not_found", "Project not found")
    return updated
  }

  return new Elysia()
    .use(authPlugin(deps))
    .post(
      "/projects/:id/logo",
      async ({ user, params, body }) => {
        await requireProjectRole(db, user.id, params.id, "admin")
        if (body.size > MAX_IMAGE_BYTES) throw payloadTooLarge("Logos can be up to 2 MB")
        if (!uploads.consume(params.id)) throw tooManyRequests()
        const logoId = `${newId()}.${IMAGE_EXTENSIONS[body.contentType]}`
        // The previous upload was never confirmed: it goes, unless it somehow became the logo in use.
        const [previous] = await db.select().from(pendingProjectLogo).where(eq(pendingProjectLogo.projectId, params.id)).limit(1)
        if (previous && (await current(params.id)).logoUrl !== logoUrl(params.id, previous.logoId)) {
          await storage.delete(projectLogoKeyFor(params.id, previous.logoId)).catch(() => {})
        }
        await db
          .insert(pendingProjectLogo)
          .values({ projectId: params.id, logoId })
          .onConflictDoUpdate({ target: pendingProjectLogo.projectId, set: { logoId, createdAt: new Date() } })
        const upload = await storage.createUploadTarget(projectLogoKeyFor(params.id, logoId), {
          contentType: body.contentType,
          maxBytes: body.size,
        })
        return { upload, logoId }
      },
      {
        auth: true,
        body: t.Object({ contentType: t.UnionEnum(["image/png", "image/jpeg"]), size: t.Integer({ minimum: 1 }) }),
      },
    )
    .post(
      "/projects/:id/logo/:logoId",
      async ({ user, params }) => {
        await requireProjectRole(db, user.id, params.id, "admin")
        const expected = imageIdType(params.logoId)
        if (!expected) throw notFound("logo_not_found", "Logo not found")
        const verdict = await checkUploadedImage(storage, projectLogoKeyFor(params.id, params.logoId), expected)
        if (verdict === "missing") throw notFound("logo_not_found", "Logo not found")
        if (verdict === "too_large") throw payloadTooLarge("Logos can be up to 2 MB")
        if (verdict === "invalid") throw unprocessable("invalid_image", "Use a PNG or JPG logo")
        await db.delete(pendingProjectLogo).where(eq(pendingProjectLogo.projectId, params.id))
        return setLogo(params.id, logoUrl(params.id, params.logoId))
      },
      { auth: true },
    )
    .delete(
      "/projects/:id/logo",
      async ({ user, params }) => {
        await requireProjectRole(db, user.id, params.id, "admin")
        return setLogo(params.id, null)
      },
      { auth: true },
    )
    // Public, like workspace logos: the ids are random and a logo is not a secret.
    .get("/project-logos/:projectId/:logoId", async ({ params }) => {
      const contentType = imageIdType(params.logoId)
      if (!contentType || !/^[A-Za-z0-9-]{1,64}$/.test(params.projectId)) throw notFound("logo_not_found", "Logo not found")
      const key = projectLogoKeyFor(params.projectId, params.logoId)
      if (!(await storage.head(key))) throw notFound("logo_not_found", "Logo not found")
      const location = await storage.getReadUrl(key, { contentType })
      return new Response(null, { status: 302, headers: { location, "cache-control": "private, max-age=300" } })
    })
}
