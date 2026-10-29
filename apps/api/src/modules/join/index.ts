import { Elysia } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { requireMember } from "../workspaces/access"
import { accessBody, valueBody } from "./model"
import { deleteJoinRequest, listJoinRequests } from "./repository"
import { createJoinService } from "./service"

/** Joining a workspace by an invite link or code, a shared link or code, or an email domain. */
export function joinModule(deps: AppDeps) {
  const { db } = deps
  const join = createJoinService(deps)

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/workspaces/:id/access",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id, "admin")
        return join.access(params.id, current)
      },
      { auth: true },
    )
    .patch(
      "/workspaces/:id/access",
      async ({ user: current, params, body }) => {
        await requireMember(db, current.id, params.id, "admin")
        return join.changeAccess(params.id, current, body)
      },
      { auth: true, body: accessBody },
    )
    .get("/join/domain", ({ user: current }) => join.domainWorkspaces(current), { auth: true })
    .post("/join/domain/:workspaceId", ({ user: current, params }) => join.joinByDomain(params.workspaceId, current), {
      auth: true,
    })
    .delete(
      "/join/domain/:workspaceId/request",
      async ({ user: current, params }) => {
        await deleteJoinRequest(db, params.workspaceId, current.id)
        return { ok: true }
      },
      { auth: true },
    )
    .get(
      "/workspaces/:id/join-requests",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id, "admin")
        return listJoinRequests(db, params.id)
      },
      { auth: true },
    )
    .post(
      "/workspaces/:id/join-requests/:userId/approve",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id, "admin")
        return join.approve(params.id, params.userId)
      },
      { auth: true },
    )
    .delete(
      "/workspaces/:id/join-requests/:userId",
      async ({ user: current, params }) => {
        await requireMember(db, current.id, params.id, "admin")
        await deleteJoinRequest(db, params.id, params.userId)
        return { ok: true }
      },
      { auth: true },
    )
    .post("/join/preview", ({ user: current, body }) => join.preview(current, body.value), { auth: true, body: valueBody })
    .post("/join", ({ user: current, body }) => join.join(current, body.value), { auth: true, body: valueBody })
    // The /join/<code> page: the same preview, for a share code only.
    .get("/join/shared/:code", ({ user: current, params }) => join.preview(current, `/join/${params.code}`), { auth: true })
}
