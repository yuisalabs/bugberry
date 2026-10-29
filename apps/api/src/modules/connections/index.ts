import { Elysia } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { requireMember } from "../workspaces/access"
import { createBody, optionsQuery, patchBody } from "./model"
import { createConnectionsService } from "./service"

export function connectionsModule(deps: AppDeps) {
  const { db } = deps
  const connections = createConnectionsService(deps)

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/workspaces/:id/connections",
      async ({ user, params }) => {
        const role = await requireMember(db, user.id, params.id)
        return connections.list(params.id, role)
      },
      { auth: true },
    )
    .post(
      "/workspaces/:id/connections",
      async ({ user, params, body }) => {
        await requireMember(db, user.id, params.id, "admin")
        return connections.create(params.id, body)
      },
      { auth: true, body: createBody },
    )
    .patch(
      "/workspaces/:id/connections/:connectionId",
      async ({ user, params, body }) => {
        await requireMember(db, user.id, params.id, "admin")
        return connections.change(params.id, params.connectionId, body)
      },
      { auth: true, body: patchBody },
    )
    .delete(
      "/workspaces/:id/connections/:connectionId",
      async ({ user, params }) => {
        await requireMember(db, user.id, params.id, "admin")
        return connections.remove(params.id, params.connectionId)
      },
      { auth: true },
    )
    .post(
      "/workspaces/:id/connections/:connectionId/test",
      async ({ user, params }) => {
        await requireMember(db, user.id, params.id, "admin")
        return connections.test(params.id, params.connectionId)
      },
      { auth: true },
    )
    .get(
      "/workspaces/:id/connections/:connectionId/options",
      async ({ user, params, query }) => {
        // Anyone in the workspace picks targets from these lists.
        await requireMember(db, user.id, params.id)
        return connections.options(params.id, params.connectionId, query)
      },
      { auth: true, query: optionsQuery },
    )
}
