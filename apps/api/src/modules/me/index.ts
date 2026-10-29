import { ONBOARDING_EVENTS } from "@bugberry/shared"
import { eq } from "drizzle-orm"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { user } from "../../db/schema"
import { onboardingProgress, recordOnboarding } from "../onboarding/progress"
import { requireMember } from "../workspaces/access"
import { canCreateWorkspace, isAccountLimited } from "../workspaces/limits"

export function meModule(deps: AppDeps) {
  const { db } = deps
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
        await db.update(user).set({ lastWorkspaceId: body.workspaceId }).where(eq(user.id, current.id))
        return { ok: true }
      },
      { auth: true, body: t.Object({ workspaceId: t.String({ minLength: 1 }) }) },
    )
}
