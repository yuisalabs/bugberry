import { Elysia } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { requireProjectRole } from "../workspaces/access"
import { createBody, patchBody } from "./model"
import { createIntegrationsService } from "./service"

export function integrationsModule(deps: AppDeps) {
  const { db } = deps
  const integrations = createIntegrationsService(deps)

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/projects/:id/integrations",
      async ({ user, params }) => {
        await requireProjectRole(db, user.id, params.id)
        return integrations.list(params.id)
      },
      { auth: true },
    )
    .post(
      "/projects/:id/integrations",
      async ({ user, params, body }) => {
        const workspaceId = await requireProjectRole(db, user.id, params.id)
        return integrations.create(workspaceId, params.id, body)
      },
      { auth: true, body: createBody },
    )
    .patch(
      "/projects/:id/integrations/:integrationId",
      async ({ user, params, body }) => {
        await requireProjectRole(db, user.id, params.id)
        return integrations.change(params.id, params.integrationId, body)
      },
      { auth: true, body: patchBody },
    )
    .delete(
      "/projects/:id/integrations/:integrationId",
      async ({ user, params }) => {
        await requireProjectRole(db, user.id, params.id)
        return integrations.remove(params.id, params.integrationId)
      },
      { auth: true },
    )
    .post(
      "/projects/:id/integrations/:integrationId/test",
      async ({ user, params }) => {
        await requireProjectRole(db, user.id, params.id)
        return integrations.test(params.id, params.integrationId)
      },
      { auth: true },
    )
}
