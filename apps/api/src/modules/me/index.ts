import { eq } from "drizzle-orm"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../app"
import { authPlugin } from "../../auth/plugin"
import { user } from "../../db/schema"
import { requireMember } from "../../workspaces/access"
import { canCreateWorkspace } from "../../workspaces/limits"

export function meModule(deps: AppDeps) {
  const { db } = deps
  return new Elysia()
    .use(authPlugin(deps))
    .get("/me", ({ user: current }) => current, { auth: true })
    .get("/me/limits", async ({ user: current }) => ({ canCreateWorkspace: await canCreateWorkspace(db, deps.config.accountLimits, current.id) }), {
      auth: true,
    })
    .put(
      "/me/workspace",
      async ({ user: current, body }) => {
        await requireMember(db, current.id, body.workspaceId)
        await db.update(user).set({ lastWorkspaceId: body.workspaceId }).where(eq(user.id, current.id))
        return { ok: true }
      },
      { auth: true, body: t.Object({ workspaceId: t.String({ minLength: 1 }) }) },
    )
}
