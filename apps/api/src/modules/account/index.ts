import { ONBOARDING_EVENTS } from "@bugberry/shared"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { notFound, unprocessable } from "../../lib/errors"
import { imageUploads } from "../../lib/image-upload"
import { avatarKeyFor as avatarKey } from "../../storage/keys"
import { onboardingProgress, recordOnboarding } from "../onboarding/progress"
import { requireMember } from "../workspaces/access"
import { canCreateWorkspace, isAccountLimited } from "../workspaces/limits"
import {
  deletePendingAvatar,
  findCurrentUser,
  findPendingAvatar,
  linkedProviders,
  setPendingAvatar,
  updateUser,
} from "./repository"

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const PROVIDERS = ["google", "github", "gitlab"] as const
const UPLOADS_PER_PERSON_PER_HOUR = 20

/** The signed-in person: who they are, their limits and checklist, their profile, photo and sign-in methods. */
export function accountModule(deps: AppDeps) {
  const { db, storage, config } = deps

  const profile = async (userId: string) => {
    const row = await findCurrentUser(db, userId)
    if (!row) throw notFound("user_not_found", "User not found")
    return row
  }
  // A photo from the person's sign-in provider is a link from elsewhere: replacing it deletes nothing.
  const photos = imageUploads({
    storage,
    keyFor: avatarKey,
    urlFor: (userId, avatarId) => `${config.appUrl}/api/avatars/${userId}/${avatarId}`,
    currentUrl: async (userId) => (await profile(userId)).image,
    pending: {
      find: async (userId) => (await findPendingAvatar(db, userId))?.avatarId ?? null,
      set: (userId, avatarId) => setPendingAvatar(db, userId, avatarId),
      remove: (userId) => deletePendingAvatar(db, userId),
    },
    uploadsPerHour: UPLOADS_PER_PERSON_PER_HOUR,
    maxBytes: MAX_AVATAR_BYTES,
    copy: {
      tooLarge: "Photos can be up to 2 MB",
      invalid: "Use a PNG or JPG photo",
      notFoundCode: "avatar_not_found",
      notFound: "Photo not found",
    },
  })
  const setImage = async (userId: string, image: string | null) => {
    const before = await profile(userId)
    await updateUser(db, userId, { image })
    await photos.dropReplaced(userId, before.image, image)
    return profile(userId)
  }

  return new Elysia()
    .use(authPlugin(deps))
    .get("/me", ({ user: current }) => current, { auth: true })
    // What the dashboard offers: "Create workspace", and inviting teammates into a workspace this person creates.
    .get(
      "/me/limits",
      async ({ user: current }) => ({
        canCreateWorkspace: await canCreateWorkspace(db, deps.config.accountLimits, current.id),
        canAddMembers: !(await isAccountLimited(db, deps.config.accountLimits, current.id)),
      }),
      { auth: true },
    )
    // The Getting started checklist in this workspace; `progress` is null when there is none to show.
    .get(
      "/me/onboarding",
      async ({ user: current, query }) => {
        await requireMember(db, current.id, query.workspaceId)
        return { progress: await onboardingProgress(db, current.id, query.workspaceId) }
      },
      { auth: true, query: t.Object({ workspaceId: t.String({ minLength: 1 }) }) },
    )
    .post(
      "/me/onboarding",
      async ({ user: current, body }) => {
        await recordOnboarding(db, current.id, body)
        return { ok: true }
      },
      {
        auth: true,
        body: t.Union([t.Object({ event: t.UnionEnum([...ONBOARDING_EVENTS]) }), t.Object({ collapsed: t.Boolean() })]),
      },
    )
    .put(
      "/me/workspace",
      async ({ user: current, body }) => {
        await requireMember(db, current.id, body.workspaceId)
        await updateUser(db, current.id, { lastWorkspaceId: body.workspaceId })
        return { ok: true }
      },
      { auth: true, body: t.Object({ workspaceId: t.String({ minLength: 1 }) }) },
    )
    .patch(
      "/me",
      async ({ user: current, body }) => {
        const name = body.name.trim()
        if (!name) throw unprocessable("invalid_name", "Display name can't be empty")
        await updateUser(db, current.id, { name })
        return profile(current.id)
      },
      { auth: true, body: t.Object({ name: t.String({ minLength: 1, maxLength: 80 }) }) },
    )
    .post(
      "/me/avatar",
      async ({ user: current, body }) => {
        const { upload, imageId } = await photos.start(current.id, body)
        return { upload, avatarId: imageId }
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
        return setImage(current.id, await photos.confirm(current.id, params.avatarId))
      },
      { auth: true },
    )
    .delete("/me/avatar", ({ user: current }) => setImage(current.id, null), { auth: true })
    .get(
      "/me/sign-in-methods",
      async ({ user: current }) => {
        const linked = new Set(await linkedProviders(db, current.id))
        const methods: Array<(typeof PROVIDERS)[number] | "email"> = PROVIDERS.filter((provider) => linked.has(provider))
        if (config.email) methods.push("email")
        return { methods }
      },
      { auth: true },
    )
    // Public: avatars show on share pages to people who are not signed in.
    .get("/avatars/:userId/:avatarId", ({ params }) => photos.serve(params.userId, params.avatarId))
}
