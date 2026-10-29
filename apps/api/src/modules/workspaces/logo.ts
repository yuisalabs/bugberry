import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { notFound, payloadTooLarge, tooManyRequests, unprocessable } from "../../lib/errors"
import { newId } from "../../lib/ids"
import { checkUploadedImage, IMAGE_EXTENSIONS, imageIdType, MAX_IMAGE_BYTES } from "../../lib/image-upload"
import { createRateLimiter } from "../../lib/rate-limit"
import { logoKeyFor } from "../../storage/keys"
import { requireMember } from "./access"
import { deletePendingLogo, findPendingLogo, findWorkspaceSummary, setPendingLogo, setWorkspaceLogo } from "./repository"

/** Each upload target lets an admin put up to 2 MB in storage, so they are capped per workspace. */
const UPLOADS_PER_WORKSPACE_PER_HOUR = 20

/** A workspace's logo: admins upload, replace or remove it; anyone may load it (it is just an image). */
export function workspaceLogoModule(deps: AppDeps) {
  const { db, storage, config } = deps
  const uploads = createRateLimiter({ limit: UPLOADS_PER_WORKSPACE_PER_HOUR, windowMs: 60 * 60 * 1000 })
  const logoUrl = (workspaceId: string, logoId: string) => `${config.appUrl}/api/workspace-logos/${workspaceId}/${logoId}`

  const summary = async (workspaceId: string) => {
    const row = await findWorkspaceSummary(db, workspaceId)
    if (!row) throw notFound("workspace_not_found", "Workspace not found")
    return { ...row, slug: row.slug ?? "" }
  }
  /** The storage key behind a logo link of this workspace, or null for none. */
  const uploadedKey = (workspaceId: string, url: string | null) => {
    const prefix = logoUrl(workspaceId, "")
    if (!url?.startsWith(prefix)) return null
    const logoId = url.slice(prefix.length)
    return imageIdType(logoId) ? logoKeyFor(workspaceId, logoId) : null
  }
  const setLogo = async (workspaceId: string, url: string | null) => {
    const before = await summary(workspaceId)
    await setWorkspaceLogo(db, workspaceId, url)
    const old = uploadedKey(workspaceId, before.logoUrl)
    if (old && old !== uploadedKey(workspaceId, url)) await storage.delete(old).catch(() => {})
    return summary(workspaceId)
  }

  return new Elysia()
    .use(authPlugin(deps))
    .post(
      "/workspaces/:id/logo",
      async ({ user: current, params, body }) => {
        await requireMember(db, current.id, params.id, "admin")
        if (body.size > MAX_IMAGE_BYTES) throw payloadTooLarge("Logos can be up to 2 MB")
        if (!uploads.consume(params.id)) throw tooManyRequests()
        const logoId = `${newId()}.${IMAGE_EXTENSIONS[body.contentType]}`
        // The previous upload was never confirmed: it goes, unless it somehow became the logo in use.
        const previous = await findPendingLogo(db, params.id)
        if (previous && (await summary(params.id)).logoUrl !== logoUrl(params.id, previous.logoId)) {
          await storage.delete(logoKeyFor(params.id, previous.logoId)).catch(() => {})
        }
        await setPendingLogo(db, params.id, logoId)
        const upload = await storage.createUploadTarget(logoKeyFor(params.id, logoId), {
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
      "/workspaces/:id/logo/:logoId",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id, "admin")
        const expected = imageIdType(params.logoId)
        if (!expected) throw notFound("logo_not_found", "Logo not found")
        const verdict = await checkUploadedImage(storage, logoKeyFor(params.id, params.logoId), expected)
        if (verdict === "missing") throw notFound("logo_not_found", "Logo not found")
        if (verdict === "too_large") throw payloadTooLarge("Logos can be up to 2 MB")
        if (verdict === "invalid") throw unprocessable("invalid_image", "Use a PNG or JPG logo")
        await deletePendingLogo(db, params.id)
        return setLogo(params.id, logoUrl(params.id, params.logoId))
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
    .get("/workspace-logos/:workspaceId/:logoId", async ({ params }) => {
      const contentType = imageIdType(params.logoId)
      if (!contentType || !/^[A-Za-z0-9-]{1,64}$/.test(params.workspaceId)) throw notFound("logo_not_found", "Logo not found")
      const key = logoKeyFor(params.workspaceId, params.logoId)
      if (!(await storage.head(key))) throw notFound("logo_not_found", "Logo not found")
      const location = await storage.getReadUrl(key, { contentType })
      return new Response(null, { status: 302, headers: { location, "cache-control": "private, max-age=300" } })
    })
}
