import { Elysia } from "elysia"
import type { AppDeps } from "../../app"
import { AppError, badRequest, conflict, notFound, payloadTooLarge, unauthorized } from "../../lib/errors"
import { LocalStorageDriver, ObjectExistsError } from "../../storage/local"

/** Upload/download endpoints that stand in for presigned URLs when STORAGE_DRIVER=local. */
export function localFilesModule(deps: Pick<AppDeps, "storage">) {
  const local = deps.storage instanceof LocalStorageDriver ? deps.storage : null

  return new Elysia()
    .put(
      "/uploads/local/:token",
      async ({ params, request }) => {
        if (!local) throw notFound()
        const claims = local.verifyUploadToken(params.token)
        if (!claims) throw unauthorized("Upload link is invalid or expired")

        const contentType = request.headers.get("content-type")?.split(";")[0]?.trim()
        if (contentType !== claims.t) {
          throw new AppError(415, "unsupported_media_type", `Expected content-type ${claims.t}`)
        }
        const declaredLength = Number(request.headers.get("content-length"))
        if (Number.isFinite(declaredLength) && declaredLength > claims.m) throw payloadTooLarge()
        if (await local.head(claims.k)) throw conflict("already_uploaded", "This upload link was already used")
        if (!request.body) throw badRequest("empty_body", "Request body is empty")

        let size: number
        try {
          size = await local.writeObject(claims.k, request.body, { exclusive: true })
        } catch (error) {
          if (error instanceof ObjectExistsError) throw conflict("already_uploaded", "This upload link was already used")
          throw error
        }
        if (size > claims.m) {
          await local.delete(claims.k)
          throw payloadTooLarge()
        }
        return { ok: true, size }
      },
      { parse: "none" },
    )
    .get("/files/:token", async ({ params, set }) => {
      if (!local) throw notFound()
      const claims = local.verifyReadToken(params.token)
      if (!claims) throw unauthorized("File link is invalid or expired")
      const file = local.openObject(claims.k)
      if (!(await file.exists())) throw notFound("file_not_found", "File not found")
      set.headers["content-type"] = claims.t
      set.headers["cache-control"] = "private, max-age=300"
      return file
    })
}
