import { asc, eq } from "drizzle-orm"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../app"
import { authPlugin } from "../../auth/plugin"
import { account, pendingAvatar, user } from "../../db/schema"
import { notFound, payloadTooLarge, tooManyRequests, unprocessable } from "../../lib/errors"
import { newId } from "../../lib/ids"
import { checkUploadedImage, IMAGE_EXTENSIONS, IMAGE_ID, IMAGE_TYPES, imageIdType } from "../../lib/image-upload"
import { createRateLimiter } from "../../lib/rate-limit"
import { avatarKeyFor as avatarKey } from "../../storage/keys"

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const PROVIDERS = ["google", "github", "gitlab"] as const
/** Each upload target lets someone put up to 2 MB in storage, so they are capped per person. */
const UPLOADS_PER_PERSON_PER_HOUR = 20

const profileColumns = { id: user.id, email: user.email, name: user.name, image: user.image, lastWorkspaceId: user.lastWorkspaceId }

/** The person's own profile: display name, photo and how they sign in. */
export function accountModule(deps: AppDeps) {
  const { db, storage, config } = deps
  const uploads = createRateLimiter({ limit: UPLOADS_PER_PERSON_PER_HOUR, windowMs: 60 * 60 * 1000 })
  const avatarUrl = (userId: string, avatarId: string) => `${config.appUrl}/api/avatars/${userId}/${avatarId}`

  const profile = async (userId: string) => {
    const [row] = await db.select(profileColumns).from(user).where(eq(user.id, userId)).limit(1)
    if (!row) throw notFound("user_not_found", "User not found")
    return row
  }
  /** The storage key of the photo this person uploaded, or null for none or a photo from their sign-in provider. */
  const uploadedKey = (userId: string, image: string | null) => {
    const prefix = avatarUrl(userId, "")
    if (!image?.startsWith(prefix)) return null
    const avatarId = image.slice(prefix.length)
    return IMAGE_ID.test(avatarId) ? avatarKey(userId, avatarId) : null
  }
  const setImage = async (userId: string, image: string | null) => {
    const before = await profile(userId)
    await db.update(user).set({ image }).where(eq(user.id, userId))
    const old = uploadedKey(userId, before.image)
    if (old && old !== uploadedKey(userId, image)) await storage.delete(old).catch(() => {})
    return profile(userId)
  }

  return new Elysia()
    .use(authPlugin(deps))
    .patch(
      "/me",
      async ({ user: current, body }) => {
        const name = body.name.trim()
        if (!name) throw unprocessable("invalid_name", "Display name can't be empty")
        await db.update(user).set({ name }).where(eq(user.id, current.id))
        return profile(current.id)
      },
      { auth: true, body: t.Object({ name: t.String({ minLength: 1, maxLength: 80 }) }) },
    )
    .post(
      "/me/avatar",
      async ({ user: current, body }) => {
        if (body.size > MAX_AVATAR_BYTES) throw payloadTooLarge("Photos can be up to 2 MB")
        if (!uploads.consume(current.id)) throw tooManyRequests()
        const avatarId = `${newId()}.${IMAGE_EXTENSIONS[body.contentType]}`
        // The previous upload was never confirmed: it goes, unless it somehow became the photo in use.
        const [previous] = await db.select().from(pendingAvatar).where(eq(pendingAvatar.userId, current.id)).limit(1)
        if (previous) {
          const inUse = (await profile(current.id)).image === avatarUrl(current.id, previous.avatarId)
          if (!inUse) await storage.delete(avatarKey(current.id, previous.avatarId)).catch(() => {})
        }
        await db
          .insert(pendingAvatar)
          .values({ userId: current.id, avatarId })
          .onConflictDoUpdate({ target: pendingAvatar.userId, set: { avatarId, createdAt: new Date() } })
        const upload = await storage.createUploadTarget(avatarKey(current.id, avatarId), {
          contentType: body.contentType,
          maxBytes: body.size,
        })
        return { upload, avatarId }
      },
      {
        auth: true,
        body: t.Object({
          contentType: t.UnionEnum(["image/png", "image/jpeg"]),
          size: t.Integer({ minimum: 1 }),
        }),
      },
    )
    .post(
      "/me/avatar/:avatarId",
      async ({ user: current, params }) => {
        const expected = imageIdType(params.avatarId)
        if (!expected) throw notFound("avatar_not_found", "Photo not found")
        const verdict = await checkUploadedImage(storage, avatarKey(current.id, params.avatarId), expected, MAX_AVATAR_BYTES)
        if (verdict === "missing") throw notFound("avatar_not_found", "Photo not found")
        if (verdict === "too_large") throw payloadTooLarge("Photos can be up to 2 MB")
        if (verdict === "invalid") throw unprocessable("invalid_image", "Use a PNG or JPG photo")
        await db.delete(pendingAvatar).where(eq(pendingAvatar.userId, current.id))
        return setImage(current.id, avatarUrl(current.id, params.avatarId))
      },
      { auth: true },
    )
    .delete("/me/avatar", ({ user: current }) => setImage(current.id, null), { auth: true })
    .get(
      "/me/sign-in-methods",
      async ({ user: current }) => {
        const rows = await db
          .select({ providerId: account.providerId })
          .from(account)
          .where(eq(account.userId, current.id))
          .orderBy(asc(account.createdAt))
        const linked = new Set(rows.map((row) => row.providerId))
        const methods: Array<(typeof PROVIDERS)[number] | "email"> = PROVIDERS.filter((provider) => linked.has(provider))
        if (config.email) methods.push("email")
        return { methods }
      },
      { auth: true },
    )
    // Public: avatars show on share pages to people who are not signed in.
    .get("/avatars/:userId/:avatarId", async ({ params }) => {
      const match = IMAGE_ID.exec(params.avatarId)
      if (!match || !/^[A-Za-z0-9-]{1,64}$/.test(params.userId)) throw notFound("avatar_not_found", "Photo not found")
      const key = avatarKey(params.userId, params.avatarId)
      if (!(await storage.head(key))) throw notFound("avatar_not_found", "Photo not found")
      const location = await storage.getReadUrl(key, { contentType: IMAGE_TYPES[match[1] as keyof typeof IMAGE_TYPES] })
      return new Response(null, { status: 302, headers: { location, "cache-control": "private, max-age=300" } })
    })
}
